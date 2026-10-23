import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { APP_DIRECTORY, LIMITS, loadConfig, providerReadiness } from "../src/config.ts";
import { loadMigrations, migrateDatabase, openDatabase } from "../src/db.ts";
import { startServer } from "../src/server.ts";

let directory: string;
const databases = new Set<Database>();
const servers: Bun.Server<undefined>[] = [];
const fakeSecret = "fake-secret-must-never-be-output";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "marginalia-search-"));
});

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
  for (const db of databases) db.close();
  databases.clear();
  rmSync(directory, { recursive: true, force: true });
});

function config(env: Record<string, string | undefined> = {}) {
  return loadConfig({ env, policyPath: join(directory, "metadata-policy.json") });
}

function database() {
  const path = join(directory, "data", "search.sqlite");
  migrateDatabase(path);
  const db = openDatabase(path);
  databases.add(db);
  return { db, path };
}

function close(db: Database) {
  db.close();
  databases.delete(db);
}

function reviewedPolicy() {
  return {
    revision: "test-only-v1",
    providers: {
      tmdb: {
        provider: "tmdb",
        reviewedAt: "2026-01-01",
        permissionBasis: "test-only fixture, no live permissions",
        retainedFields: ["id", "title", "name"],
        displayedFields: ["title", "name"],
      },
      exa: {
        provider: "exa",
        reviewedAt: "2026-01-01",
        permissionBasis: "test-only fixture, no live permissions",
        retainedFields: ["id", "url", "title"],
        displayedFields: ["url", "title"],
      },
    },
  };
}

function savePolicy(value: unknown) {
  writeFileSync(join(directory, "metadata-policy.json"), JSON.stringify(value));
}

function insertRequest(db: Database, id = "request-1") {
  db.run("INSERT INTO search_requests (id, limits_snapshot) VALUES (?, ?)", [
    id,
    JSON.stringify(LIMITS),
  ]);
}

function seedResolution(db: Database, suffix = "1") {
  const requestId = `request-${suffix}`;
  const inputId = `input-${suffix}`;
  const operationId = `resolution-${suffix}`;
  const attemptId = `resolution-attempt-${suffix}`;
  const candidateId = `candidate-${suffix}`;
  insertRequest(db, requestId);
  db.run(
    "INSERT INTO title_inputs (id, request_id, position, original_title, search_title) VALUES (?, ?, 0, 'Heat', 'Heat')",
    [inputId, requestId],
  );
  db.run("INSERT INTO operations (id, request_id, kind, input_id) VALUES (?, ?, 'resolution', ?)", [
    operationId,
    requestId,
    inputId,
  ]);
  db.run(
    "INSERT INTO operation_attempts (id, operation_id, attempt_number, provider, query, template_version, started_at, deadline_at) VALUES (?, ?, 1, 'tmdb', 'Heat', '1', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z')",
    [attemptId, operationId],
  );
  db.run(
    "INSERT INTO resolution_candidates (id, input_id, attempt_id, ordinal, provider, provider_media_type, provider_id, title, work_type, retrieved_at, eligible) VALUES (?, ?, ?, 0, 'tmdb', 'movie', 949, 'Heat', 'film', '2026-01-01T00:00:01Z', 1)",
    [candidateId, inputId, attemptId],
  );
  return { requestId, inputId, operationId, attemptId, candidateId };
}

function seedSearch(db: Database) {
  const ids = seedResolution(db);
  db.run(
    "UPDATE title_inputs SET resolution_state = 'resolved', selected_candidate_id = ?, selected_at = '2026-01-01T00:00:02Z' WHERE id = ?",
    [ids.candidateId, ids.inputId],
  );
  db.run(
    "INSERT INTO works (id, provider, provider_media_type, provider_id, title, work_type, identity_url, retrieved_at) VALUES ('work-1', 'tmdb', 'movie', 949, 'Heat', 'film', 'https://www.themoviedb.org/movie/949', '2026-01-01T00:00:01Z')",
  );
  db.run(
    "INSERT INTO request_works (request_id, work_id, selected_candidate_id) VALUES (?, 'work-1', ?)",
    [ids.requestId, ids.candidateId],
  );
  db.run(
    "INSERT INTO operations (id, request_id, kind, work_id) VALUES ('search-1', ?, 'search', 'work-1')",
    [ids.requestId],
  );
  db.run(
    "INSERT INTO operation_attempts (id, operation_id, attempt_number, provider, query, template_version, started_at, deadline_at) VALUES ('search-attempt-1', 'search-1', 1, 'exa', 'Heat 1995 film criticism', '1', '2026-01-01T00:00:03Z', '2026-01-01T00:01:03Z')",
  );
  db.run(
    "INSERT INTO sources (id, normalized_url, source_host) VALUES ('source-1', 'https://example.com/heat', 'example.com')",
  );
  db.run(
    "INSERT INTO search_records (id, request_id, work_id, source_id) VALUES ('record-1', ?, 'work-1', 'source-1')",
    [ids.requestId],
  );
  db.run(
    "INSERT INTO source_observations (id, search_record_id, attempt_id, ordinal, original_url, observed_at, metadata_policy_revision) VALUES ('observation-1', 'record-1', 'search-attempt-1', 0, 'https://example.com/heat#review', '2026-01-01T00:00:04Z', 'test-only-v1')",
  );
  return ids;
}

function serve() {
  const { db } = database();
  const server = startServer({ db, config: config({ EXA_API_KEY: fakeSecret }), port: 0 });
  servers.push(server);
  return { db, server };
}

function http(
  server: Bun.Server<undefined>,
  {
    method = "GET",
    path = "/health",
    headers = {},
    chunks = [],
  }: {
    method?: string;
    path?: string;
    headers?: import("node:http").OutgoingHttpHeaders;
    chunks?: string[];
  } = {},
) {
  return new Promise<{
    status: number;
    headers: import("node:http").IncomingHttpHeaders;
    text: string;
  }>((resolveResponse, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port: server.port, path, method, headers },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () =>
          resolveResponse({ status: res.statusCode ?? 0, headers: res.headers, text }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

describe("configuration and metadata policy", () => {
  test("database paths are anchored to the app, including from another working directory", () => {
    expect(config().databasePath).toBe(join(APP_DIRECTORY, "data/search.sqlite"));
    expect(config({ MARGINALIA_DB_PATH: "custom/search.sqlite" }).databasePath).toBe(
      join(APP_DIRECTORY, "custom/search.sqlite"),
    );
    const absolute = join(directory, "absolute.sqlite");
    expect(config({ MARGINALIA_DB_PATH: absolute }).databasePath).toBe(absolute);
    const previous = process.cwd();
    try {
      process.chdir(directory);
      expect(config({ MARGINALIA_DB_PATH: "custom/search.sqlite" }).databasePath).toBe(
        join(APP_DIRECTORY, "custom/search.sqlite"),
      );
    } finally {
      process.chdir(previous);
    }
  });

  test("missing credentials and policy disable providers without preventing configuration", () => {
    const readiness = providerReadiness(config());
    expect(readiness.tmdb).toEqual({
      credentialsConfigured: false,
      metadataPolicyReady: false,
      ready: false,
      reasons: ["provider_credentials", "metadata_policy_missing"],
    });
    expect(readiness.exa.ready).toBe(false);
  });

  test("reviewed test policy and credentials are evaluated independently per provider", () => {
    savePolicy(reviewedPolicy());
    const loaded = config({ EXA_API_KEY: fakeSecret });
    expect(providerReadiness(loaded).exa.ready).toBe(true);
    expect(providerReadiness(loaded).tmdb).toMatchObject({
      credentialsConfigured: false,
      metadataPolicyReady: true,
      ready: false,
    });
    expect(JSON.stringify(providerReadiness(loaded))).not.toContain(fakeSecret);
  });

  test.each([
    "unreviewed",
    "invalid-date",
    "invalid-basis",
    "unknown-field",
    "display-outside-retention",
    "wrong-provider",
    "duplicate-field",
  ])("rejects %s policy for only the affected provider", (kind) => {
    const policy = reviewedPolicy();
    switch (kind) {
      case "unreviewed":
        policy.providers.tmdb.reviewedAt = "";
        break;
      case "invalid-date":
        policy.providers.tmdb.reviewedAt = "2026-02-30";
        break;
      case "invalid-basis":
        policy.providers.tmdb.permissionBasis = " ";
        break;
      case "unknown-field":
        policy.providers.tmdb.retainedFields.push("overview");
        break;
      case "display-outside-retention":
        policy.providers.tmdb.displayedFields.push("original_title");
        break;
      case "wrong-provider":
        policy.providers.tmdb.provider = "exa";
        break;
      case "duplicate-field":
        policy.providers.tmdb.retainedFields.push("id");
        break;
    }
    savePolicy(policy);
    const readiness = providerReadiness(
      config({ EXA_API_KEY: fakeSecret, TMDB_READ_ACCESS_TOKEN: fakeSecret }),
    );
    expect(readiness.tmdb.metadataPolicyReady).toBe(false);
    expect(readiness.exa.ready).toBe(true);
  });

  test("malformed policy and the committed template fail closed", () => {
    writeFileSync(join(directory, "metadata-policy.json"), `{${fakeSecret}`);
    expect(providerReadiness(config()).exa.metadataPolicyReady).toBe(false);
    const template = loadConfig({
      env: {},
      policyPath: join(APP_DIRECTORY, "metadata-policy.json"),
    });
    expect(providerReadiness(template).tmdb.ready).toBe(false);
    expect(providerReadiness(template).exa.ready).toBe(false);
  });
});

describe("storage lifecycle", () => {
  test("migrations are repeatable and durable settings and committed identities survive reopen", () => {
    const { db, path } = database();
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
    seedSearch(db);
    close(db);
    migrateDatabase(path);
    const reopened = openDatabase(path);
    databases.add(reopened);
    expect(reopened.query("SELECT id FROM works").all()).toEqual([{ id: "work-1" }]);
    expect(reopened.query("SELECT id FROM source_observations").all()).toEqual([
      { id: "observation-1" },
    ]);
    expect(reopened.query("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({
      count: 1,
    });
  });

  test("runtime never creates missing storage or initializes an empty database", () => {
    const missing = join(directory, "missing.sqlite");
    expect(() => openDatabase(missing)).toThrow("storage_unavailable");
    expect(existsSync(missing)).toBe(false);
    const empty = new Database(missing);
    empty.close();
    expect(() => openDatabase(missing)).toThrow("schema_migration_required");
  });

  test("failed upgrades roll back DDL, data changes, and migration records", () => {
    const { db, path } = database();
    insertRequest(db);
    close(db);
    expect(() =>
      migrateDatabase(path, [
        ...loadMigrations(),
        {
          version: 2,
          sql: `CREATE TABLE transient_table (id TEXT); DELETE FROM search_requests; INVALID SQL ${fakeSecret};`,
        },
      ]),
    ).toThrow("storage_unavailable");
    const reopened = openDatabase(path);
    databases.add(reopened);
    expect(reopened.query("SELECT id FROM search_requests").all()).toEqual([{ id: "request-1" }]);
    expect(
      reopened.query("SELECT name FROM sqlite_schema WHERE name = 'transient_table'").get(),
    ).toBeNull();
    expect(reopened.query("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
      version: 1,
    });
  });

  test("successful upgrades preserve rows and failed first migrations leave no schema", () => {
    const { db, path } = database();
    insertRequest(db);
    close(db);
    const migrations = [
      ...loadMigrations(),
      { version: 2, sql: "CREATE TABLE upgrade_check (id TEXT);" },
    ];
    migrateDatabase(path, migrations);
    const upgraded = openDatabase(path, migrations);
    databases.add(upgraded);
    expect(upgraded.query("SELECT id FROM search_requests").all()).toEqual([{ id: "request-1" }]);
    expect(upgraded.query("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
    const freshPath = join(directory, "failed-first.sqlite");
    expect(() =>
      migrateDatabase(freshPath, [
        { version: 1, sql: "CREATE TABLE partial_schema (id TEXT); INVALID SQL;" },
      ]),
    ).toThrow("storage_unavailable");
    const inspect = new Database(freshPath, { readonly: true });
    expect(inspect.query("SELECT name FROM sqlite_schema WHERE type = 'table'").all()).toEqual([]);
    inspect.close();
  });

  test("a failed ordinary transaction preserves earlier commits", () => {
    const { db } = database();
    insertRequest(db);
    expect(() =>
      db
        .transaction(() => {
          insertRequest(db, "request-2");
          insertRequest(db);
        })
        .immediate(),
    ).toThrow();
    expect(db.query("SELECT id FROM search_requests").all()).toEqual([{ id: "request-1" }]);
  });

  test("changed checksums, skipped versions, and unknown newer schemas are rejected", () => {
    const { db, path } = database();
    insertRequest(db);
    close(db);
    const migrations = loadMigrations();
    expect(() =>
      openDatabase(
        path,
        migrations.map((migration) => ({ ...migration, sql: migration.sql + "\n-- changed" })),
      ),
    ).toThrow("schema_checksum_mismatch");
    expect(() => migrateDatabase(path, [{ version: 3, sql: "SELECT 1;" }])).toThrow(
      "schema_migrations_invalid",
    );
    const raw = new Database(path);
    raw.run("INSERT INTO schema_migrations (version, checksum) VALUES (2, 'unknown')");
    raw.close();
    expect(() => openDatabase(path)).toThrow("schema_newer_than_runtime");
    expect(() => migrateDatabase(path)).toThrow("schema_newer_than_runtime");
    const inspect = new Database(path, { readonly: true });
    expect(inspect.query("SELECT id FROM search_requests").all()).toEqual([{ id: "request-1" }]);
    inspect.close();
  });

  test("runtime refuses pending migrations and missing schema objects", () => {
    const { db, path } = database();
    close(db);
    expect(() =>
      openDatabase(path, [...loadMigrations(), { version: 2, sql: "SELECT 1;" }]),
    ).toThrow("schema_migration_required");
    const raw = new Database(path);
    raw.run("DROP TABLE rejected_results");
    raw.close();
    expect(() => openDatabase(path)).toThrow("schema_invalid");
  });

  test.each([
    "ALTER TABLE sources DROP COLUMN source_host",
    "ALTER TABLE works DROP COLUMN original_title",
    "ALTER TABLE operation_attempts DROP COLUMN retry_at",
    "DROP TRIGGER observations_no_update",
    "DROP TRIGGER candidate_attempt_ownership",
  ])("rejects incomplete schemas without changing committed rows: %s", (damage) => {
    const { db, path } = database();
    insertRequest(db);
    db.run(damage);
    close(db);
    expect(() => {
      databases.add(openDatabase(path));
    }).toThrow("schema_invalid");
    expect(() => migrateDatabase(path)).toThrow("schema_invalid");
    const inspect = new Database(path, { readonly: true });
    try {
      expect(inspect.query("SELECT id FROM search_requests").all()).toEqual([{ id: "request-1" }]);
    } finally {
      inspect.close();
    }
  });

  test("CLI migration and runtime use the same app-relative path from different directories", async () => {
    const path = join(directory, "cli.sqlite");
    const env = { PATH: process.env.PATH, MARGINALIA_DB_PATH: relative(APP_DIRECTORY, path) };
    const migration = Bun.spawn(
      [process.execPath, "--no-env-file", join(APP_DIRECTORY, "src/db.ts"), "--migrate"],
      { cwd: directory, env, stdout: "pipe", stderr: "pipe" },
    );
    expect(await migration.exited).toBe(0);
    expect(existsSync(path)).toBe(true);
    const db = openDatabase(
      loadConfig({ env, policyPath: join(directory, "missing.json") }).databasePath,
    );
    databases.add(db);
    expect(db.query("SELECT version FROM schema_migrations").all()).toEqual([{ version: 1 }]);
  });

  test("CLI storage failures are safe and preserve the original file", async () => {
    const path = join(directory, "corrupt.sqlite");
    writeFileSync(path, fakeSecret);
    for (const entrypoint of ["db.ts", "server.ts"]) {
      const child = Bun.spawn(
        [
          process.execPath,
          "--no-env-file",
          join(APP_DIRECTORY, "src", entrypoint),
          ...(entrypoint === "db.ts" ? ["--migrate"] : []),
        ],
        {
          env: { PATH: process.env.PATH, MARGINALIA_DB_PATH: path, EXA_API_KEY: fakeSecret },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(await child.exited).toBe(1);
      const output =
        (await new Response(child.stdout).text()) + (await new Response(child.stderr).text());
      expect(output).toContain("storage_unavailable");
      expect(output).not.toContain(fakeSecret);
      expect(readFileSync(path, "utf8")).toBe(fakeSecret);
    }
  });
});

describe("relational constraints", () => {
  test("selection and operation attempts cannot cross input or operation ownership", () => {
    const { db } = database();
    const first = seedResolution(db);
    const second = seedResolution(db, "2");
    expect(() =>
      db.run(
        "UPDATE title_inputs SET resolution_state = 'resolved', selected_candidate_id = ?, selected_at = '2026-01-01T00:00:02Z' WHERE id = ?",
        [second.candidateId, first.inputId],
      ),
    ).toThrow();
    expect(() =>
      db.run("UPDATE operations SET state = 'running', current_attempt_id = ? WHERE id = ?", [
        second.attemptId,
        first.operationId,
      ]),
    ).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO operations (id, request_id, kind, input_id) VALUES ('cross-request', ?, 'resolution', ?)",
        [second.requestId, first.inputId],
      ),
    ).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO resolution_candidates (id, input_id, attempt_id, ordinal, provider, provider_media_type, provider_id, title, work_type, retrieved_at, eligible) VALUES ('cross-attempt', ?, ?, 1, 'tmdb', 'movie', 1, 'Wrong', 'film', '2026-01-01T00:00:01Z', 1)",
        [second.inputId, first.attemptId],
      ),
    ).toThrow();
  });

  test("membership changes and observation publication preserve request/work provenance", () => {
    const { db } = database();
    seedSearch(db);
    const second = seedResolution(db, "2");
    expect(() =>
      db.run("UPDATE request_works SET selected_candidate_id = ? WHERE request_id = 'request-1'", [
        second.candidateId,
      ]),
    ).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO request_works (request_id, work_id, selected_candidate_id) VALUES (?, 'work-1', 'candidate-1')",
        [second.requestId],
      ),
    ).toThrow();
    expect(() =>
      db.run("UPDATE resolution_candidates SET input_id = ? WHERE id = 'candidate-1'", [
        second.inputId,
      ]),
    ).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO source_observations (id, search_record_id, attempt_id, ordinal, original_url, observed_at, metadata_policy_revision) VALUES ('cross-observation', 'record-1', ?, 1, 'https://example.com/heat', '2026-01-01T00:00:04Z', 'test-only-v1')",
        [second.attemptId],
      ),
    ).toThrow();
    db.run(
      "INSERT INTO resolution_candidates (id, input_id, attempt_id, ordinal, provider, provider_media_type, provider_id, title, work_type, retrieved_at, eligible, ineligible_reason) VALUES ('ineligible', ?, ?, 1, 'tmdb', 'movie', 1, 'Wrong year', 'film', '2026-01-01T00:00:01Z', 0, 'conflicting_details')",
      [second.inputId, second.attemptId],
    );
    expect(() =>
      db.run(
        "UPDATE title_inputs SET resolution_state = 'resolved', selected_candidate_id = 'ineligible', selected_at = '2026-01-01T00:00:02Z' WHERE id = ?",
        [second.inputId],
      ),
    ).toThrow();
  });

  test("identity, membership, operation targets, and observations enforce their constraints", () => {
    const { db } = database();
    seedSearch(db);
    expect(() =>
      db.run(
        "INSERT INTO request_works (request_id, work_id, selected_candidate_id) VALUES ('request-1', 'work-1', 'candidate-1')",
      ),
    ).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO search_records (id, request_id, work_id, source_id) VALUES ('duplicate', 'request-1', 'work-1', 'source-1')",
      ),
    ).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO sources (id, normalized_url, source_host) VALUES ('duplicate', 'https://example.com/heat', 'example.com')",
      ),
    ).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO operations (id, request_id, kind, input_id, work_id) VALUES ('invalid', 'request-1', 'search', 'input-1', 'work-1')",
      ),
    ).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO operations (id, request_id, kind) VALUES ('missing-target', 'request-1', 'resolution')",
      ),
    ).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO search_records (id, request_id, work_id, source_id) VALUES ('missing-membership', 'missing', 'work-1', 'source-1')",
      ),
    ).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO operation_attempts (id, operation_id, attempt_number, provider, query, template_version, started_at, deadline_at) SELECT 'duplicate-attempt', operation_id, attempt_number, provider, query, template_version, started_at, deadline_at FROM operation_attempts WHERE id = 'search-attempt-1'",
      ),
    ).toThrow();
    expect(() =>
      db.run("UPDATE source_observations SET title = 'Changed' WHERE id = 'observation-1'"),
    ).toThrow();
    expect(() => db.run("DELETE FROM source_observations WHERE id = 'observation-1'")).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO works (id, provider, provider_media_type, provider_id, title, work_type, identity_url, retrieved_at) SELECT 'duplicate', provider, provider_media_type, provider_id, title, work_type, identity_url, retrieved_at FROM works WHERE id = 'work-1'",
      ),
    ).toThrow();
    db.run(
      "INSERT INTO works (id, provider, provider_media_type, provider_id, title, work_type, identity_url, retrieved_at) VALUES ('tv-same-id', 'tmdb', 'tv', 949, 'Different show', 'television_series', 'https://www.themoviedb.org/tv/949', '2026-01-01T00:00:01Z')",
    );
    expect(db.query("SELECT COUNT(*) AS count FROM works").get()).toEqual({ count: 2 });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("loopback HTTP foundation", () => {
  test("health separates storage readiness and provider readiness without secrets or CORS", async () => {
    const { server } = serve();
    expect(server.hostname).toBe("127.0.0.1");
    const response = await http(server);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toMatchObject({
      storage: { ready: true },
      providers: { exa: { credentialsConfigured: true, metadataPolicyReady: false, ready: false } },
    });
    expect(response.text).not.toContain(fakeSecret);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect((await http(server, { path: "/unknown" })).status).toBe(404);
  });

  test.each([
    { Host: "evil.example:4310" },
    { Host: "localhost:4310" },
    { Host: "127.0.0.1:1" },
    { Origin: "http://127.0.0.1:4310" },
    { Origin: "null" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" },
  ])("rejects unsafe headers %j", async (headers) => {
    const { server } = serve();
    const response = await http(server, { headers });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.text)).toHaveProperty("error.details", []);
  });

  test("mutation validation distinguishes unsupported media, malformed JSON, and absent routes", async () => {
    const { server } = serve();
    expect((await http(server, { method: "POST", chunks: ["{}"] })).status).toBe(415);
    expect(
      (
        await http(server, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          chunks: ["{}"],
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await http(server, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          chunks: ["{"],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await http(server, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          chunks: ["{}"],
        })
      ).status,
    ).toBe(404);
  });

  test("enforces byte limits for declared and chunked bodies and accepts the exact boundary", async () => {
    const { server } = serve();
    const oversized = " ".repeat(LIMITS.maxBodyBytes + 1);
    const declared = await http(server, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(oversized.length) },
      chunks: [oversized],
    });
    expect(declared.status).toBe(413);
    const streamed = await http(server, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" },
      chunks: [" ".repeat(8000), "é".repeat(5000)],
    });
    expect(streamed.status).toBe(413);
    expect(JSON.parse(streamed.text).error.code).toBe("body_too_large");
    const exact = await http(server, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      chunks: ["{}" + " ".repeat(LIMITS.maxBodyBytes - 2)],
    });
    expect(exact.status).toBe(404);
  });

  test.each(["GET", "HEAD", "OPTIONS"])(
    "rejects declared and streamed bodies on %s requests",
    async (method) => {
      const { server } = serve();
      for (const headers of [
        { "Content-Length": String(LIMITS.maxBodyBytes + 1) },
        { "Transfer-Encoding": "chunked" },
      ]) {
        const response = await http(server, {
          method,
          headers,
          chunks: [" ".repeat(8000), " ".repeat(LIMITS.maxBodyBytes + 1 - 8000)],
        });
        expect(response.status).toBe(400);
        if (method !== "HEAD")
          expect(JSON.parse(response.text).error.code).toBe("body_not_allowed");
      }
      expect(
        (await http(server, { method, headers: { "Content-Length": "2" }, chunks: ["{}"] })).status,
      ).toBe(400);
      expect((await http(server, { headers: { "Content-Length": "0" } })).status).toBe(200);
    },
  );

  test("storage failure is visible after startup and fake secrets never enter saved state or errors", async () => {
    const { db, server } = serve();
    const malformed = await http(server, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      chunks: [`{${fakeSecret}`],
    });
    expect(malformed.status).toBe(400);
    expect(malformed.text).not.toContain(fakeSecret);
    expect(db.query("SELECT COUNT(*) AS count FROM search_requests").get()).toEqual({ count: 0 });
    expect(db.serialize().includes(Buffer.from(fakeSecret))).toBe(false);
    close(db);
    const response = await http(server);
    expect(response.status).toBe(503);
    expect(JSON.parse(response.text).error.code).toBe("storage_unavailable");
    expect(response.text).not.toContain(fakeSecret);
  });

  test("raw exceptions containing fake credentials are redacted from HTTP and diagnostics", async () => {
    const { db, server } = serve();
    let diagnostics = "";
    const log = spyOn(process.stderr, "write").mockImplementation((chunk) => {
      diagnostics += String(chunk);
      return true;
    });
    const query = spyOn(db, "query").mockImplementationOnce(() => {
      throw new Error(fakeSecret);
    });
    try {
      const response = await http(server);
      expect(response.status).toBe(503);
      expect(response.text).not.toContain(fakeSecret);
      expect(diagnostics).toContain("storage_unavailable");
      expect(diagnostics).not.toContain(fakeSecret);
    } finally {
      query.mockRestore();
      log.mockRestore();
    }
  });
});
