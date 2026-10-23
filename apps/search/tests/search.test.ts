import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { APP_DIRECTORY, LIMITS, loadConfig, providerReadiness } from "../src/config.ts";
import { loadMigrations, migrateDatabase, openDatabase } from "../src/db.ts";
import { startServer } from "../src/server.ts";
import { createWorker } from "../src/worker.ts";
import type { TmdbFetch } from "../src/providers/tmdb.ts";
import tmdbFixtures from "./fixtures/tmdb.json" with { type: "json" };

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
      },
      exa: {
        provider: "exa",
        reviewedAt: "2026-01-01",
        permissionBasis: "test-only fixture, no live permissions",
      },
    },
  };
}

function savePolicy(value: unknown) {
  writeFileSync(join(directory, "metadata-policy.json"), JSON.stringify(value));
}

function insertRequest(db: Database, id = "request-1") {
  db.run("INSERT INTO search_requests (id) VALUES (?)", [id]);
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
    "legacy-retention",
    "legacy-display",
    "future-date",
    "wrong-provider",
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
      case "legacy-retention":
        Object.assign(policy.providers.tmdb, { retainedFields: ["id", "title"] });
        break;
      case "legacy-display":
        Object.assign(policy.providers.tmdb, { displayedFields: ["title"] });
        break;
      case "wrong-provider":
        policy.providers.tmdb.provider = "exa";
        break;
      case "future-date":
        policy.providers.tmdb.reviewedAt = "9999-01-01";
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

  test("runtime refuses pending migrations", () => {
    const { db, path } = database();
    close(db);
    expect(() =>
      openDatabase(path, [...loadMigrations(), { version: 2, sql: "SELECT 1;" }]),
    ).toThrow("schema_migration_required");
  });

  test("startup still rejects foreign-key violations", () => {
    const { db, path } = database();
    seedResolution(db);
    db.run("PRAGMA foreign_keys = OFF");
    db.run("UPDATE title_inputs SET request_id = 'missing'");
    close(db);
    expect(() => openDatabase(path)).toThrow("schema_invalid");
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
    expect(db.query("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 1 },
    ]);
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

function resolutionSetup(fetcher: TmdbFetch = async () => Response.json(tmdbFixtures.movies)) {
  const { db, path } = database();
  savePolicy(reviewedPolicy());
  const configuration = config({ TMDB_READ_ACCESS_TOKEN: fakeSecret });
  const server = startServer({ db, config: configuration, port: 0 });
  servers.push(server);
  const worker = createWorker({ db, config: configuration, fetch: fetcher });
  async function api(route = "", body?: unknown) {
    const response = await http(server, {
      path: `/v1/search-requests${route}`,
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      chunks: body === undefined ? [] : [JSON.stringify(body)],
    });
    return { status: response.status, body: JSON.parse(response.text) };
  }
  async function submit(inputs: unknown = [{ title: " Heat ", workType: "film" }]) {
    const response = await api("", { inputs });
    expect(response.status).toBe(202);
    return response.body.requestId as string;
  }
  async function summary(id: string) {
    return (await api(`/${id}`)).body;
  }
  async function candidates(id: string, inputId: string, query = "") {
    return api(`/${id}/inputs/${inputId}/candidates${query}`);
  }
  return { db, path, configuration, server, worker, api, submit, summary, candidates };
}

function searchSetup(
  searchFetch: TmdbFetch = async () =>
    Response.json({
      requestId: "fixture-exa-request",
      notices: [{ code: "RESTRICTIONS_RELAXED", message: fakeSecret }],
      results: [
        {
          id: "shared",
          url: "https://EXAMPLE.com:443/shared#review",
          title: "Same title",
          text: fakeSecret,
        },
        { id: "other", url: "https://example.com/other", title: "Same title", summary: fakeSecret },
        { url: "http://127.0.0.1/private", title: fakeSecret },
      ],
    }),
) {
  const calls: string[] = [];
  const s = resolutionSetup(async (url, init) => {
    expect(s.db.inTransaction).toBe(false);
    if (url.hostname === "api.exa.ai") {
      calls.push(String(init.body));
      return searchFetch(url, init);
    }
    const title = url.searchParams.get("query");
    const tv = url.pathname.endsWith("tv");
    return Response.json({
      results: [
        {
          id: title?.startsWith("Work ")
            ? Number(title.slice(5)) + 1000
            : title === "Arrival"
              ? 329865
              : tv
                ? 1396
                : 949,
          ...(tv
            ? { name: "Breaking Bad", first_air_date: "2008-01-20" }
            : {
                title: title?.startsWith("Work ")
                  ? title
                  : title === "Arrival"
                    ? "Arrival"
                    : "Heat",
                release_date: title === "Arrival" ? "2016-09-01" : "1995-12-15",
              }),
        },
      ],
    });
  });
  s.configuration.providers.exa.credential = fakeSecret;
  async function confirm(id: string) {
    const summary = await s.summary(id);
    const selections = [];
    for (const input of summary.inputs) {
      const candidate = (await s.candidates(id, input.id)).body.items[0];
      selections.push({ inputId: input.id, candidateId: candidate.id });
    }
    expect((await s.api(`/${id}/selections`, { selections })).status).toBe(200);
  }
  return { ...s, calls, confirm };
}

describe("US3 failure status and selective retry", () => {
  test("partial success retries only the failure and preserves completed observations", async () => {
    let failing = true;
    const s = searchSetup(async (_url, init) => {
      if (String(init.body).includes("Arrival") && failing)
        return new Response(fakeSecret, { status: 429, headers: { "Retry-After": "120" } });
      return Response.json({ results: [{ url: "https://example.com/shared" }] });
    });
    const id = await s.submit([
      { title: "Heat", workType: "film" },
      { title: "Arrival", workType: "film" },
    ]);
    await s.worker.runOnce();
    await s.worker.runOnce();
    await s.confirm(id);
    await s.worker.runOnce();
    const original = s.db.query("SELECT * FROM source_observations").all();
    await s.worker.runOnce();
    const summary = await s.summary(id);
    expect(summary.status).toBe("partial");
    expect(summary.coverage.map((o: { state: string }) => o.state)).toEqual([
      "sources_found",
      "failed",
    ]);
    const action = summary.nextActions[0];
    expect(action).toMatchObject({
      action: "retry_operation",
      errorCode: "provider_rate_limit",
      workId: summary.coverage[1].workId,
    });
    expect(Date.parse(action.retryAt) - Date.now()).toBeGreaterThan(110_000);
    expect(JSON.stringify(summary)).not.toContain(fakeSecret);
    const before = s.db.serialize();
    expect((await s.api(`/${id}/retry`, { operationIds: [action.operationId] })).status).toBe(409);
    expect((await s.api(`/${id}/retry`, {})).body).toEqual({ queuedOperationIds: [] });
    expect(s.db.serialize()).toEqual(before);
    s.db.run(
      "UPDATE operation_attempts SET retry_at = ? WHERE error_code = 'provider_rate_limit'",
      [new Date(Date.now() - 1).toISOString()],
    );
    const conflict = await s.api(`/${id}/retry`, {
      operationIds: [action.operationId, summary.coverage[0].operationId],
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("operation_not_retryable");
    const results = await Promise.all([s.api(`/${id}/retry`, {}), s.api(`/${id}/retry`, {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 202]);
    expect(results.flatMap((r) => r.body.queuedOperationIds)).toEqual([action.operationId]);
    expect((await s.api(`/${id}/retry`, { operationIds: [action.operationId] })).status).toBe(409);
    failing = false;
    await s.worker.runOnce();
    expect((await s.summary(id)).status).toBe("completed");
    expect(await s.worker.runOnce()).toBe(false);
    expect(s.calls).toHaveLength(3);
    expect(s.db.query("SELECT * FROM source_observations ORDER BY seq LIMIT 1").all()).toEqual(
      original,
    );
    expect(
      s.db
        .query(
          "SELECT attempt_number, state FROM operation_attempts WHERE operation_id = ? ORDER BY attempt_number",
        )
        .all(action.operationId),
    ).toEqual([
      { attempt_number: 1, state: "failed" },
      { attempt_number: 2, state: "succeeded" },
    ]);
    expect((await s.api(`/${id}/retry`, {})).status).toBe(200);
  });

  test("retry validates the entire explicit list, scope, capacity and storage atomically", async () => {
    const s = resolutionSetup();
    s.configuration.providers.tmdb.credential = null;
    const id = await s.submit();
    await s.worker.runOnce();
    const action = (await s.summary(id)).nextActions[0];
    expect(action).toMatchObject({
      action: "configure_credentials",
      errorCode: "provider_credentials",
    });
    const other = await s.submit();
    const otherOp = s.db
      .query<{ id: string }, [string]>("SELECT id FROM operations WHERE request_id = ?")
      .get(other);
    if (!otherOp) throw new Error("Expected operation");
    for (const [body, status] of [
      [{ operationIds: [action.operationId, "missing"] }, 404],
      [{ operationIds: [action.operationId, otherOp.id] }, 404],
      [{ operationIds: [action.operationId, action.operationId] }, 422],
      [{ operationIds: [] }, 422],
      [{ operationIds: Array(21).fill("x") }, 422],
      [{ operationIds: null }, 422],
      [{ extra: true }, 422],
    ] as const) {
      const before = s.db.serialize();
      expect((await s.api(`/${id}/retry`, body)).status).toBe(status);
      expect(s.db.serialize()).toEqual(before);
    }
    expect((await s.api("/missing/retry", {})).status).toBe(404);
    expect((await s.api(`/${id}/retry?extra=1`, {})).status).toBe(400);
    for (let i = 1; i < LIMITS.maxActiveRequests; i++) await s.submit();
    const before = s.db.serialize();
    expect((await s.api(`/${id}/retry`, {})).body.error.code).toBe("local_capacity");
    expect(s.db.serialize()).toEqual(before);
    s.db.run("UPDATE operations SET state = 'failed' WHERE request_id = ?", [other]);
    s.db.run(
      "CREATE TRIGGER fail_retry BEFORE UPDATE OF resolution_state ON title_inputs WHEN NEW.resolution_state = 'pending' BEGIN SELECT RAISE(ABORT, 'fake-secret-must-never-be-output'); END",
    );
    const retryBefore = s.db.serialize();
    const response = await s.api(`/${id}/retry`, {});
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain(fakeSecret);
    expect(s.db.serialize()).toEqual(retryBefore);
  });

  test("resolution failures and required selections remain visible during resolving", async () => {
    const s = resolutionSetup(async (url) =>
      url.searchParams.get("query") === "Broken"
        ? new Response(null, { status: 503 })
        : Response.json(tmdbFixtures.movies),
    );
    const id = await s.submit([
      { title: "Heat", workType: "film" },
      { title: "Broken", workType: "film" },
      { title: "Pending", workType: "film" },
    ]);
    await s.worker.runOnce();
    const before = Date.now();
    await s.worker.runOnce();
    const summary = await s.summary(id);
    expect(summary.status).toBe("resolving");
    expect(summary.nextActions.map((a: { action: string }) => a.action)).toEqual([
      "retry_operation",
      "select_candidate",
    ]);
    expect(Date.parse(summary.nextActions[0].retryAt)).toBeGreaterThanOrEqual(
      before + LIMITS.retryDelayMs,
    );
    expect((await s.api(`/${id}/retry`, {})).status).toBe(200);
    await s.worker.runOnce();
    expect((await s.summary(id)).status).toBe("blocked");
  });

  test.each([false, true])(
    "provider-empty and all-rejected remain distinct successful outcomes, rejected=%s",
    async (rejected) => {
      const s = searchSetup(async () =>
        Response.json({ results: rejected ? [{ url: "http://localhost/private" }] : [] }),
      );
      const id = await s.submit();
      await s.worker.runOnce();
      await s.confirm(id);
      await s.worker.runOnce();
      const summary = await s.summary(id);
      expect(summary.status).toBe("completed");
      expect(summary.coverage[0]).toMatchObject({
        state: "no_sources",
        returnedCount: rejected ? 1 : 0,
        retainedCount: 0,
        rejectedCount: rejected ? 1 : 0,
      });
      expect((await s.api(`/${id}/retry`, {})).status).toBe(200);
      expect(s.calls).toHaveLength(1);
    },
  );

  test("unmatched and declined inputs require clarification and cannot be technically retried", async () => {
    const s = resolutionSetup(async () => Response.json({ results: [] }));
    const id = await s.submit();
    await s.worker.runOnce();
    const summary = await s.summary(id);
    expect(summary.inputs[0].unresolvedReason).toBe("no_match");
    expect(summary.nextActions[0].action).toBe("submit_clarified_input");
    expect((await s.api(`/${id}/retry`, {})).body).toEqual({ queuedOperationIds: [] });
    await s.api(`/${id}/selections`, {
      selections: [{ inputId: summary.inputs[0].id, candidateId: null }],
    });
    expect((await s.summary(id)).inputs[0].unresolvedReason).toBe("declined");
    expect((await s.api(`/${id}/retry`, {})).status).toBe(200);
    expect(await s.worker.runOnce()).toBe(false);
  });
});

describe("US1 persisted source search", () => {
  test("source pagination freezes associations already present and excludes later work matches", async () => {
    const s = searchSetup();
    const id = await s.submit([
      { title: "Heat", workType: "film" },
      { title: "Arrival", workType: "film" },
      { title: "Breaking Bad", workType: "television_series" },
    ]);
    for (let i = 0; i < 3; i++) await s.worker.runOnce();
    await s.confirm(id);
    await s.worker.runOnce();
    await s.worker.runOnce();
    const first = (await s.api(`/${id}/sources?limit=1`)).body;
    const route = `/${id}/sources?limit=1&cursor=${first.nextCursor}`;
    const before = (await s.api(route)).body;
    expect(before.items[0].workIds).toHaveLength(2);
    await s.worker.runOnce();
    expect((await s.api(route)).body).toEqual(before);
    expect((await s.api(`/${id}/sources`)).body.items[0].workIds).toHaveLength(3);
  });
  test("full result caps persist and source/work pagination reaches all rows", async () => {
    const s = searchSetup(async (_url, init) => {
      const query = JSON.parse(String(init.body)).query;
      return Response.json({
        results: Array.from({ length: 20 }, (_, i) => ({
          url: `https://example.com/${encodeURIComponent(query)}/${i}`,
        })),
      });
    });
    const id = await s.submit(
      Array.from({ length: 6 }, (_, i) => ({ title: `Work ${i}`, workType: "film" })),
    );
    for (let i = 0; i < 6; i++) await s.worker.runOnce();
    await s.confirm(id);
    for (let i = 0; i < 6; i++) await s.worker.runOnce();
    const summary = await s.summary(id);
    expect(summary.status).toBe("completed");
    expect(summary.limitFlags).toContain("result_limit_reached");
    expect(s.db.query("SELECT count(*) n FROM source_observations").get()).toEqual({ n: 120 });
    const first = (await s.api(`/${id}/sources?limit=100`)).body;
    expect(first.items).toHaveLength(100);
    const second = (await s.api(`/${id}/sources?limit=100&cursor=${first.nextCursor}`)).body;
    expect(second.items).toHaveLength(20);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(120);
    const workIds = [];
    let cursor: string | null = null;
    do {
      const result: { items: { id: string }[]; nextCursor: string | null } = (
        await s.api(`/${id}/works?limit=1${cursor ? `&cursor=${cursor}` : ""}`)
      ).body;
      workIds.push(...result.items.map((row: { id: string }) => row.id));
      cursor = result.nextCursor;
    } while (cursor);
    expect(new Set(workIds).size).toBe(6);
  });

  test("pending search resumes after reopen and graceful cancellation interrupts the active search", async () => {
    const s = searchSetup();
    const id = await s.submit();
    await s.worker.runOnce();
    await s.confirm(id);
    await s.worker.stop();
    await s.server.stop(true);
    close(s.db);
    const reopened = openDatabase(s.path);
    databases.add(reopened);
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const worker = createWorker({
      db: reopened,
      config: s.configuration,
      fetch: async (_url, init) => {
        began();
        return new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error(fakeSecret)), {
            once: true,
          }),
        );
      },
    });
    const active = worker.runOnce();
    await started;
    expect(await worker.runOnce()).toBe(false);
    await worker.stop();
    await active;
    expect(reopened.query("SELECT state FROM operations WHERE kind = 'search'").get()).toEqual({
      state: "interrupted",
    });
    expect(
      reopened
        .query("SELECT state, error_code FROM operation_attempts WHERE provider = 'exa'")
        .get(),
    ).toEqual({ state: "interrupted", error_code: "operation_interrupted" });
    expect(reopened.query("SELECT count(*) n FROM sources").get()).toEqual({ n: 0 });
  });

  test.each(["expired", "superseded"])(
    "%s search attempts cannot publish late sources",
    async (mode) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const s = searchSetup(async () => {
        await held;
        return Response.json({ results: [{ url: "https://example.com/late" }] });
      });
      const id = await s.submit();
      await s.worker.runOnce();
      await s.confirm(id);
      const active = s.worker.runOnce();
      const operation = s.db
        .query<{ id: string; current_attempt_id: string }, []>(
          "SELECT id, current_attempt_id FROM operations WHERE kind = 'search'",
        )
        .get();
      if (!operation) throw new Error("Expected active search operation.");
      if (mode === "expired")
        s.db.run("UPDATE operation_attempts SET deadline_at = ? WHERE id = ?", [
          new Date(Date.now() - 1000).toISOString(),
          operation.current_attempt_id,
        ]);
      else {
        const newer = crypto.randomUUID();
        s.db.run(
          "INSERT INTO operation_attempts (id, operation_id, attempt_number, provider, query, template_version, started_at, deadline_at) VALUES (?, ?, 2, 'exa', 'new query', 'exa-search-v1', ?, ?)",
          [
            newer,
            operation.id,
            new Date().toISOString(),
            new Date(Date.now() + 60000).toISOString(),
          ],
        );
        s.db.run("UPDATE operations SET current_attempt_id = ? WHERE id = ?", [
          newer,
          operation.id,
        ]);
      }
      const before = s.db.serialize();
      release();
      await active;
      expect(s.db.serialize()).toEqual(before);
      expect(s.db.query("SELECT count(*) n FROM sources").get()).toEqual({ n: 0 });
    },
  );

  test("confirmed works search once each, share sources, and keep query/rank/time after offline reopen", async () => {
    const s = searchSetup();
    const id = await s.submit([
      { title: "Heat", year: 1995, workType: "film" },
      { title: "Heat alias", workType: "film" },
      { title: "Arrival", year: 2016, workType: "film" },
      { title: "Breaking Bad", year: 2008, workType: "television_series" },
    ]);
    for (let i = 0; i < 4; i++) expect(await s.worker.runOnce()).toBe(true);
    expect(await s.worker.runOnce()).toBe(false);
    expect(s.calls).toHaveLength(0);
    await s.confirm(id);
    for (let i = 0; i < 3; i++) expect(await s.worker.runOnce()).toBe(true);
    expect(await s.worker.runOnce()).toBe(false);
    expect(s.calls.map((body) => JSON.parse(body).query)).toEqual([
      "Heat 1995 film criticism analysis interviews themes filmmaking",
      "Arrival 2016 film criticism analysis interviews themes filmmaking",
      "Breaking Bad 2008 television series criticism analysis interviews themes filmmaking",
    ]);
    const summary = await s.summary(id);
    expect(summary).toMatchObject({ status: "completed", distinctWorkCount: 3 });
    expect(
      summary.coverage.map((c: { retainedCount: number; rejectedCount: number }) => [
        c.retainedCount,
        c.rejectedCount,
      ]),
    ).toEqual([
      [2, 1],
      [2, 1],
      [2, 1],
    ]);
    const works = await s.api(`/${id}/works?limit=100`);
    expect(works.status).toBe(200);
    expect(works.body.items).toHaveLength(3);
    expect(works.body.items[0].inputIds).toHaveLength(2);
    const sources = await s.api(`/${id}/sources?limit=100`);
    expect(sources.status).toBe(200);
    expect(sources.body.items).toHaveLength(2);
    expect(sources.body.items[0]).toMatchObject({
      kind: "source_candidate",
      relevanceVerified: false,
      url: "https://example.com/shared",
      workIds: works.body.items.map((w: { id: string }) => w.id),
      processingPermission: "unknown",
      displayPermission: "unknown",
    });
    const sourceId = sources.body.items[0].id;
    const observations = await http(s.server, {
      path: `/v1/sources/${sourceId}/observations?limit=100`,
    });
    expect(observations.status).toBe(200);
    const savedObservations = JSON.parse(observations.text);
    expect(savedObservations.items).toHaveLength(3);
    expect(savedObservations.items[0]).toMatchObject({
      requestId: id,
      provider: "exa",
      rank: 1,
      publisher: null,
      query: JSON.parse(s.calls[0] ?? "{}").query,
      noticeCodes: ["RESTRICTIONS_RELAXED"],
      metadataPolicyRevision: "test-only-v1",
    });
    expect(savedObservations.items[0].observedAt).toBeString();
    expect(s.db.query("SELECT count(*) n FROM sources").get()).toEqual({ n: 2 });
    expect(s.db.query("SELECT count(*) n FROM search_records").get()).toEqual({ n: 6 });
    expect(s.db.query("SELECT count(*) n FROM rejected_results").get()).toEqual({ n: 3 });
    expect(s.db.serialize().includes(Buffer.from(fakeSecret))).toBe(false);
    const paths = [
      `/v1/search-requests/${id}`,
      `/v1/search-requests/${id}/works?limit=100`,
      `/v1/search-requests/${id}/sources?limit=100`,
      `/v1/works/${works.body.items[0].id}`,
      `/v1/sources/${sourceId}`,
      `/v1/sources/${sourceId}/observations?limit=100`,
    ];
    const before = [];
    for (const path of paths) before.push(JSON.parse((await http(s.server, { path })).text));
    await s.worker.stop();
    await s.server.stop(true);
    close(s.db);
    const reopened = openDatabase(s.path);
    databases.add(reopened);
    const offlineConfig = config();
    const offline = startServer({ db: reopened, config: offlineConfig, port: 0 });
    servers.push(offline);
    const network = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        () => {
          throw new Error("Unexpected network call");
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    try {
      for (const [index, path] of paths.entries()) {
        const saved = await http(offline, { path });
        expect(saved.status).toBe(200);
        const { snapshotAt: _current, ...savedValue } = JSON.parse(saved.text);
        const { snapshotAt: _previous, ...previousValue } = before[index];
        expect(savedValue).toEqual(previousValue);
      }
      expect(network).not.toHaveBeenCalled();
      expect(await createWorker({ db: reopened, config: offlineConfig }).runOnce()).toBe(false);
    } finally {
      network.mockRestore();
    }
    offlineConfig.providers.exa.policy = null;
    expect((await http(offline, { path: `/v1/sources/${sourceId}` })).status).toBe(503);
    expect((await http(offline, { path: `/v1/search-requests/${id}/sources` })).status).toBe(503);
    expect((await http(offline, { path: `/v1/sources/${sourceId}/observations` })).status).toBe(
      503,
    );
    offlineConfig.providers.tmdb.policy = null;
    expect((await http(offline, { path: `/v1/works/${works.body.items[0].id}` })).status).toBe(503);
    expect((await http(offline, { path: `/v1/search-requests/${id}/works` })).status).toBe(503);
    expect((await http(offline, { path: `/v1/search-requests/${id}` })).status).toBe(200);
    expect((await http(offline, { path: "/v1/search-requests" })).status).toBe(200);
  });

  test("saved lists use scoped snapshot pagination, validate queries, and preserve repeated requests", async () => {
    const s = searchSetup();
    const first = await s.submit();
    await s.worker.runOnce();
    await s.confirm(first);
    await s.worker.runOnce();
    const second = await s.submit();
    await s.worker.runOnce();
    await s.confirm(second);
    await s.worker.runOnce();
    expect(s.calls).toHaveLength(2);
    expect(s.db.query("SELECT count(*) n FROM sources").get()).toEqual({ n: 2 });
    expect(s.db.query("SELECT count(*) n FROM search_records").get()).toEqual({ n: 4 });
    const firstPage = await s.api("?limit=1");
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items[0].requestId).toBe(first);
    expect(firstPage.body.nextCursor).toBeString();
    const third = await s.submit();
    const secondPage = await s.api(`?limit=100&cursor=${firstPage.body.nextCursor}`);
    expect(secondPage.body.items.map((r: { requestId: string }) => r.requestId)).toEqual([second]);
    expect(secondPage.body.nextCursor).toBeNull();
    expect(secondPage.body.snapshotAt).toBe(firstPage.body.snapshotAt);
    expect(
      (await s.api("?limit=100")).body.items.map((r: { requestId: string }) => r.requestId),
    ).toEqual([first, second, third]);
    const page = await s.api(`/${first}/sources?limit=1`);
    expect(page.body.nextCursor).toBeString();
    const next = await s.api(`/${first}/sources?limit=1&cursor=${page.body.nextCursor}`);
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
    expect(next.body.nextCursor).toBeNull();
    const workId = (await s.api(`/${first}/works`)).body.items[0].id;
    expect((await s.api(`/${first}/sources?workId=${workId}`)).body.items).toHaveLength(2);
    for (const route of [
      `/${second}/sources?cursor=${page.body.nextCursor}`,
      `/${first}/sources?workId=${workId}&cursor=${page.body.nextCursor}`,
      `/${first}/works?cursor=${page.body.nextCursor}`,
      "/missing/sources",
      `/${first}/sources?workId=missing`,
    ])
      expect((await s.api(route)).status).toBe(route.includes("missing") ? 404 : 400);
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=01",
      "limit=-1",
      "limit=1&limit=2",
      "cursor=garbage",
      "extra=x",
      "workId=x",
    ]) {
      expect((await s.api(`?${query}`)).status).toBe(400);
    }
    const sourceId = page.body.items[0].id;
    const observation = await http(s.server, {
      path: `/v1/sources/${sourceId}/observations?limit=1`,
    });
    const observationPage = JSON.parse(observation.text);
    expect(observationPage.nextCursor).toBeString();
    const observationNext = await http(s.server, {
      path: `/v1/sources/${sourceId}/observations?cursor=${observationPage.nextCursor}`,
    });
    expect(JSON.parse(observationNext.text).items[0].requestId).toBe(second);
    const filtered = await http(s.server, {
      path: `/v1/sources/${sourceId}/observations?requestId=${first}`,
    });
    expect(JSON.parse(filtered.text).items.map((o: { requestId: string }) => o.requestId)).toEqual([
      first,
    ]);
  });

  test("search publication rolls back on storage failure and empty success stays distinct", async () => {
    const s = searchSetup();
    const id = await s.submit();
    await s.worker.runOnce();
    await s.confirm(id);
    s.db.run(
      "CREATE TRIGGER reject_observation BEFORE INSERT ON source_observations WHEN NEW.ordinal = 1 BEGIN SELECT RAISE(ABORT, 'fake-secret-must-never-be-output'); END",
    );
    await s.worker.runOnce();
    expect((await s.summary(id)).status).toBe("failed");
    expect((await s.summary(id)).nextActions[0].errorCode).toBe("storage_unavailable");
    for (const table of ["sources", "source_observations", "search_records", "rejected_results"]) {
      expect(s.db.query(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    const empty = searchSetup(async () => Response.json({ results: [] }));
    const emptyId = await empty.submit();
    await empty.worker.runOnce();
    await empty.confirm(emptyId);
    await empty.worker.runOnce();
    expect((await empty.summary(emptyId)).coverage[0]).toMatchObject({
      state: "no_sources",
      returnedCount: 0,
      retainedCount: 0,
      rejectedCount: 0,
    });
    expect((await empty.summary(emptyId)).status).toBe("completed");
    expect((await empty.api(`/${emptyId}/sources`)).body.items).toEqual([]);
  });
});

describe("US2 submission and explicit selection", () => {
  test("selection storage failure rolls back writes before reaching Hono error handling", async () => {
    const s = resolutionSetup(async () => Response.json(tmdbFixtures.translated));
    const id = await s.submit();
    await s.worker.runOnce();
    const input = (await s.summary(id)).inputs[0];
    const candidate = (await s.candidates(id, input.id)).body.items[0];
    s.db.run(
      "CREATE TRIGGER reject_search BEFORE INSERT ON operations WHEN NEW.kind = 'search' BEGIN SELECT RAISE(ABORT, 'fake-secret-must-never-be-output'); END",
    );
    const before = s.db.serialize();
    const result = await s.api(`/${id}/selections`, {
      selections: [{ inputId: input.id, candidateId: candidate.id }],
    });
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe("storage_unavailable");
    expect(JSON.stringify(result.body)).not.toContain(fakeSecret);
    expect(s.db.serialize()).toEqual(before);
  });

  test("Zod issue paths stay useful without exposing unknown keys or raw errors", async () => {
    const s = resolutionSetup();
    const invalidYear = await s.api("", { inputs: [{ title: "Heat", year: null }] });
    expect(invalidYear.body.error.details).toEqual(["inputs[0].year"]);
    const unknown = await s.api("", { inputs: [{ title: "Heat" }], [fakeSecret]: true });
    expect(unknown.status).toBe(422);
    expect(JSON.stringify(unknown.body)).not.toContain(fakeSecret);
    expect(s.db.query("SELECT count(*) n FROM search_requests").get()).toEqual({ n: 0 });
  });

  test("Hono applies access controls before parsing every mutation route", async () => {
    const s = resolutionSetup();
    for (const path of ["/v1/search-requests", "/v1/search-requests/unknown/selections"]) {
      const result = await http(s.server, {
        path,
        method: "POST",
        headers: { Host: "evil.example", Origin: "http://evil.example" },
        chunks: ["not json"],
      });
      expect(result.status).toBe(403);
      expect(result.headers["x-content-type-options"]).toBe("nosniff");
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.headers["access-control-allow-origin"]).toBeUndefined();
    }
    const unknown = await http(s.server, { path: "/unknown?query=x" });
    expect(unknown.status).toBe(404);
    expect((await http(s.server, { method: "HEAD" })).status).toBe(404);
    expect(s.db.query("SELECT count(*) n FROM search_requests").get()).toEqual({ n: 0 });
  });

  test("film/TV collisions stay distinct, reselection works before freeze, and repeated requests reuse first-selected snapshots", async () => {
    let changed = false;
    const s = resolutionSetup(async (url) =>
      Response.json(
        changed
          ? { results: [{ id: 949, title: "Later label" }] }
          : url.pathname.endsWith("tv")
            ? tmdbFixtures.tv
            : tmdbFixtures.movies,
      ),
    );
    const id = await s.submit([{ title: "Heat", workType: "film" }, { title: "Heat" }]);
    await s.worker.runOnce();
    await s.worker.runOnce();
    const [a, b] = (await s.summary(id)).inputs;
    const movies = (await s.candidates(id, a.id)).body.items;
    const mixed = (await s.candidates(id, b.id)).body.items;
    expect(
      (
        await s.api(`/${id}/selections`, {
          selections: [{ inputId: a.id, candidateId: movies[1].id }],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await s.api(`/${id}/selections`, {
          selections: [{ inputId: a.id, candidateId: movies[0].id }],
        })
      ).status,
    ).toBe(200);
    const television = mixed.find(
      (c: { providerMediaType: string }) => c.providerMediaType === "tv",
    );
    expect(
      (
        await s.api(`/${id}/selections`, {
          selections: [{ inputId: b.id, candidateId: television.id }],
        })
      ).status,
    ).toBe(200);
    const frozen = await s.summary(id);
    expect(frozen.distinctWorkCount).toBe(2);
    expect(frozen.inputs[0].workId).not.toBe(frozen.inputs[1].workId);
    expect(s.db.query("SELECT count(*) n FROM operations WHERE kind = 'search'").get()).toEqual({
      n: 2,
    });
    // The shared worker now handles the two searches queued by this first selection.
    await s.worker.runOnce();
    await s.worker.runOnce();
    changed = true;
    const second = await s.submit();
    await s.worker.runOnce();
    const input = (await s.summary(second)).inputs[0];
    const c = (await s.candidates(second, input.id)).body.items[0];
    expect(c.title).toBe("Later label");
    expect(
      (
        await s.api(`/${second}/selections`, {
          selections: [{ inputId: input.id, candidateId: c.id }],
        })
      ).status,
    ).toBe(200);
    expect((await s.summary(second)).inputs[0].workId).toBe(frozen.inputs[0].workId);
    expect(s.db.query("SELECT title FROM works WHERE id = ?").get(frozen.inputs[0].workId)).toEqual(
      { title: "Heat" },
    );
  });

  test("publication rolls back entirely on storage failure and external calls run outside transactions", async () => {
    const s = resolutionSetup(async () => {
      expect(s.db.inTransaction).toBe(false);
      return Response.json(tmdbFixtures.movies);
    });
    const id = await s.submit();
    s.db.run(
      "CREATE TRIGGER fail_second_candidate BEFORE INSERT ON resolution_candidates WHEN NEW.ordinal = 1 BEGIN SELECT RAISE(ABORT, 'fake-secret-must-never-be-output'); END",
    );
    await s.worker.runOnce();
    expect(s.db.query("SELECT count(*) n FROM resolution_candidates").get()).toEqual({ n: 0 });
    const summary = await s.summary(id);
    expect(summary.status).toBe("blocked");
    expect(JSON.stringify(summary)).toContain("storage_unavailable");
    expect(JSON.stringify(summary)).not.toContain(fakeSecret);
  });

  test("read and mutation storage failures return safe 503 errors", async () => {
    const s = resolutionSetup();
    const id = await s.submit();
    close(s.db);
    for (const response of [
      await s.api(`/${id}`),
      await s.api("", { inputs: [{ title: "Heat" }] }),
    ]) {
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("storage_unavailable");
    }
  });

  test("automatic dispatch and shutdown cancel active resolution into interrupted state", async () => {
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const s = resolutionSetup();
    const worker = createWorker({
      db: s.db,
      config: s.configuration,
      fetch: async (_url, init) => {
        began();
        return new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error(fakeSecret)), {
            once: true,
          }),
        );
      },
    });
    const id = await s.submit();
    worker.start();
    try {
      await started;
      expect((await s.summary(id)).status).toBe("resolving");
    } finally {
      await worker.stop();
    }
    expect((await s.summary(id)).inputs[0].state).toBe("interrupted");
    expect(s.db.query("SELECT state, error_code FROM operation_attempts").get()).toEqual({
      state: "interrupted",
      error_code: "operation_interrupted",
    });
    expect(await worker.runOnce()).toBe(false);
  });

  test("a superseded attempt cannot publish even while its own deadline remains valid", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const s = resolutionSetup(async () => {
      await gate;
      return Response.json(tmdbFixtures.movies);
    });
    await s.submit();
    const active = s.worker.runOnce();
    const op = s.db.query<{ id: string }, []>("SELECT id FROM operations").get();
    expect(op).not.toBeNull();
    if (!op) throw new Error("Expected claimed operation");
    const newer = crypto.randomUUID();
    s.db.run(
      "INSERT INTO operation_attempts (id, operation_id, attempt_number, provider, query, template_version, started_at, deadline_at) VALUES (?, ?, 2, 'tmdb', 'Heat', 'tmdb-search-v1', ?, ?)",
      [newer, op.id, new Date().toISOString(), new Date(Date.now() + 60_000).toISOString()],
    );
    s.db.run("UPDATE operations SET current_attempt_id = ?", [newer]);
    release();
    await active;
    expect(s.db.query("SELECT count(*) n FROM resolution_candidates").get()).toEqual({ n: 0 });
    expect(s.db.query("SELECT state, current_attempt_id FROM operations").get()).toEqual({
      state: "running",
      current_attempt_id: newer,
    });
  });

  test("invalid submissions cause no writes or calls, with input-specific errors", async () => {
    let calls = 0;
    const s = resolutionSetup(async () => {
      calls++;
      return Response.json(tmdbFixtures.movies);
    });
    for (const body of [
      {},
      { inputs: [] },
      { inputs: Array(21).fill({ title: "Heat" }) },
      { inputs: [{ title: " " }] },
      { inputs: [{ title: "x".repeat(301) }] },
      { inputs: [{ title: "Heat", year: null }] },
      { inputs: [{ title: "Heat", year: 1995.5 }] },
      { inputs: [{ title: "Heat", year: 1799 }] },
      { inputs: [{ title: "Heat", year: 2201 }] },
      { inputs: [{ title: "Heat", workType: null }] },
      { inputs: [{ title: "Heat", workType: "movie" }] },
      { inputs: [{ title: "Heat", extra: true }] },
      { inputs: [{ title: "Heat" }], secret: fakeSecret },
      { inputs: [{ title: "Good" }, { title: false }] },
    ]) {
      const response = await s.api("", body);
      expect(response.status).toBe(422);
      expect(response.body.error.details.length).toBeGreaterThan(0);
      expect(JSON.stringify(response.body)).not.toContain(fakeSecret);
    }
    expect(s.db.query("SELECT count(*) n FROM search_requests").get()).toEqual({ n: 0 });
    expect(await s.worker.runOnce()).toBe(false);
    expect(calls).toBe(0);
    const id = await s.submit(Array(20).fill({ title: " Heat ", year: 1995, workType: "film" }));
    const summary = await s.summary(id);
    expect(summary.inputs).toHaveLength(20);
    expect(summary.inputs[0]).toMatchObject({
      originalTitle: " Heat ",
      title: "Heat",
      state: "pending",
    });
  });

  test("singleton needs confirmation; decline, reselection and invalid batches are atomic", async () => {
    const s = resolutionSetup(async () => Response.json(tmdbFixtures.translated));
    const id = await s.submit([
      { title: "Spirited Away", workType: "film" },
      { title: "Sen to Chihiro", workType: "film" },
    ]);
    await s.worker.runOnce();
    await s.worker.runOnce();
    const summary = await s.summary(id);
    expect(summary.status).toBe("needs_input");
    const [first, second] = summary.inputs;
    const a = (await s.candidates(id, first.id)).body.items[0];
    const b = (await s.candidates(id, second.id)).body.items[0];
    expect(a).toMatchObject({
      provider: "tmdb",
      providerMediaType: "movie",
      providerId: 129,
      eligible: true,
      identityUrl: "https://www.themoviedb.org/movie/129",
    });
    expect(a.attemptId).toBeString();
    expect(a.retrievedAt).toBeString();
    expect(summary.distinctWorkCount).toBe(0);
    expect(s.db.query("SELECT count(*) n FROM operations WHERE kind = 'search'").get()).toEqual({
      n: 0,
    });
    expect(
      (await s.api(`/${id}/selections`, { selections: [{ inputId: first.id, candidateId: null }] }))
        .status,
    ).toBe(200);
    expect((await s.summary(id)).inputs[0]).toMatchObject({
      state: "unresolved",
      unresolvedReason: "declined",
    });
    for (const selections of [
      [
        { inputId: first.id, candidateId: a.id },
        { inputId: second.id, candidateId: a.id },
      ],
      [
        { inputId: first.id, candidateId: a.id },
        { inputId: first.id, candidateId: a.id },
      ],
      [{ inputId: first.id, candidateId: a.id, extra: true }],
    ]) {
      const before = s.db.serialize();
      expect((await s.api(`/${id}/selections`, { selections })).status).toBeGreaterThanOrEqual(400);
      expect(s.db.serialize()).toEqual(before);
    }
    expect(
      (await s.api(`/${id}/selections`, { selections: [{ inputId: first.id, candidateId: a.id }] }))
        .status,
    ).toBe(200);
    const finalBody = { selections: [{ inputId: second.id, candidateId: b.id }] };
    const final = await Promise.all([
      s.api(`/${id}/selections`, finalBody),
      s.api(`/${id}/selections`, finalBody),
    ]);
    expect(final.map((r) => r.status).sort()).toEqual([200, 409]);
    const frozen = await s.summary(id);
    expect(frozen).toMatchObject({ status: "searching", distinctWorkCount: 1 });
    expect(frozen.inputs[0].workId).toBe(frozen.inputs[1].workId);
    expect(s.db.query("SELECT count(*) n FROM request_works").get()).toEqual({ n: 1 });
    expect(
      s.db
        .query("SELECT count(*) n FROM operations WHERE kind = 'search' AND state = 'pending'")
        .get(),
    ).toEqual({ n: 1 });
    close(s.db);
    const reopened = openDatabase(s.path);
    databases.add(reopened);
    expect(reopened.query("SELECT frozen_at FROM search_requests WHERE id = ?").get(id)).toEqual({
      frozen_at: frozen.frozenAt,
    });
    expect(
      reopened.query("SELECT selected_candidate_id FROM title_inputs ORDER BY position").all(),
    ).toEqual([{ selected_candidate_id: a.id }, { selected_candidate_id: b.id }]);
    const offline = startServer({ db: reopened, config: config(), port: 0 });
    servers.push(offline);
    const saved = await http(offline, { path: `/v1/search-requests/${id}` });
    expect(saved.status).toBe(200);
    expect(JSON.parse(saved.text)).toEqual(frozen);
  });

  test("conflicting and unmatched inputs remain explicit and ineligible selections change nothing", async () => {
    const s = resolutionSetup();
    const id = await s.submit([{ title: "Heat", year: 2000, workType: "film" }]);
    await s.worker.runOnce();
    const summary = await s.summary(id);
    expect(summary.inputs[0]).toMatchObject({
      state: "unresolved",
      unresolvedReason: "conflicting_details",
    });
    const c = (await s.candidates(id, summary.inputs[0].id)).body.items[0];
    const before = s.db.serialize();
    expect(
      (
        await s.api(`/${id}/selections`, {
          selections: [{ inputId: summary.inputs[0].id, candidateId: c.id }],
        })
      ).status,
    ).toBe(409);
    expect(s.db.serialize()).toEqual(before);
    const empty = resolutionSetup(async () => Response.json({ results: [] }));
    const emptyId = await empty.submit();
    await empty.worker.runOnce();
    expect((await empty.summary(emptyId)).inputs[0]).toMatchObject({
      state: "unresolved",
      unresolvedReason: "no_match",
    });
  });

  test("one failing endpoint publishes no candidates; saved failures are readable and secret-free", async () => {
    let calls = 0;
    const s = resolutionSetup(async () =>
      ++calls === 1
        ? Response.json(tmdbFixtures.movies)
        : Response.json({ error: fakeSecret }, { status: 401 }),
    );
    const id = await s.submit([{ title: "Heat" }]);
    await s.worker.runOnce();
    expect(s.db.query("SELECT count(*) n FROM resolution_candidates").get()).toEqual({ n: 0 });
    const response = await s.api(`/${id}`);
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("blocked");
    expect(response.body.nextActions).toContainEqual(
      expect.objectContaining({ action: "configure_credentials" }),
    );
    expect(s.db.serialize().includes(Buffer.from(fakeSecret))).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain(fakeSecret);
  });

  test("candidate reads return current metadata without credentials and reject query parameters", async () => {
    const s = resolutionSetup();
    const id = await s.submit();
    const inputId = (await s.summary(id)).inputs[0].id;
    expect((await s.candidates(id, inputId)).body.items).toEqual([]);
    await s.worker.runOnce();
    s.configuration.providers.tmdb.credential = null;
    const response = await s.candidates(id, inputId);
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(3);
    expect(response.body.items.map((c: { ordinal: number }) => c.ordinal)).toEqual([0, 1, 2]);
    expect(response.body).toMatchObject({
      returnedCount: 3,
      retainedCount: 3,
      coverageBounded: true,
    });
    expect(response.body.queryContext).toMatchObject({ page: 1, language: "en-US" });
    expect(response.body).not.toHaveProperty("nextCursor");
    expect(response.body).not.toHaveProperty("snapshotAt");
    expect(response.body.items[0]).not.toHaveProperty("restrictedFields");
    expect(await s.summary(id)).not.toHaveProperty("limits");
    for (const query of ["?limit=1", "?cursor=bad", "?other=x", "?limit=1&limit=2"])
      expect(await s.candidates(id, inputId, query)).toMatchObject({
        status: 400,
        body: { error: { code: "invalid_query" } },
      });
    const other = await s.submit();
    expect((await s.candidates(other, inputId)).status).toBe(404);
    expect((await s.candidates(id, "missing")).status).toBe(404);
  });

  test("missing or malformed approval blocks saved metadata but leaves local selections and status readable", async () => {
    const s = resolutionSetup();
    const id = await s.submit();
    await s.worker.runOnce();
    const inputId = (await s.summary(id)).inputs[0].id;
    const candidateId = (await s.candidates(id, inputId)).body.items[0].id;
    await s.api(`/${id}/selections`, { selections: [{ inputId, candidateId }] });
    const before = await s.summary(id);
    const records = s.db.serialize();
    for (const invalid of [null, { ...reviewedPolicy().providers.tmdb, retainedFields: ["id"] }]) {
      if (invalid === null) s.configuration.providers.tmdb.policy = null;
      else {
        savePolicy({
          ...reviewedPolicy(),
          providers: { ...reviewedPolicy().providers, tmdb: invalid },
        });
        s.configuration.providers.tmdb.policy = config().providers.tmdb.policy;
      }
      const blocked = await s.candidates(id, inputId);
      expect(blocked).toMatchObject({
        status: 503,
        body: { error: { code: "metadata_policy_missing" } },
      });
      expect(JSON.stringify(blocked.body)).not.toContain("Heat");
      expect(await s.summary(id)).toEqual(before);
      expect(s.db.serialize()).toEqual(records);
    }
  });

  test("candidate listing excludes historical attempts, orders by ordinal and stays bounded", async () => {
    const s = resolutionSetup(async () =>
      Response.json({
        results: Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: `Film ${i}` })),
      }),
    );
    const id = await s.submit();
    await s.worker.runOnce();
    const inputId = (await s.summary(id)).inputs[0].id;
    const first = await s.candidates(id, inputId);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.limitFlags).toContain("resolution_limit_reached");
    const op = s.db
      .query<{ id: string }, [string]>("SELECT id FROM operations WHERE input_id = ?")
      .get(inputId);
    if (!op) throw new Error("Expected a saved resolution operation.");
    s.db.run(
      "INSERT INTO operation_attempts (id, operation_id, attempt_number, provider, query, template_version, started_at, deadline_at) VALUES ('new-attempt', ?, 2, 'tmdb', 'New query', '1', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z')",
      [op.id],
    );
    s.db.run("UPDATE operations SET current_attempt_id = 'new-attempt' WHERE id = ?", [op.id]);
    expect((await s.candidates(id, inputId)).body.items).toEqual([]);
    for (const ordinal of [2, 0, 1])
      s.db.run(
        "INSERT INTO resolution_candidates (id, input_id, attempt_id, ordinal, provider, provider_media_type, provider_id, title, work_type, retrieved_at, eligible) VALUES (?, ?, 'new-attempt', ?, 'tmdb', 'movie', ?, 'New label', 'film', '2026-01-01T00:00:01Z', 1)",
        [`new-${ordinal}`, inputId, ordinal, ordinal + 1],
      );
    const current = (await s.candidates(id, inputId)).body;
    expect(current.items.map((c: { id: string }) => c.id)).toEqual(["new-0", "new-1", "new-2"]);
    expect(s.db.query("SELECT count(*) n FROM resolution_candidates").get()).toEqual({ n: 23 });
    expect(
      await s.api(`/${id}/selections`, {
        selections: [{ inputId, candidateId: first.body.items[0].id }],
      }),
    ).toMatchObject({ status: 409, body: { error: { code: "candidate_ineligible" } } });
  });

  test("capacity limits reject submissions and final selection without partial writes", async () => {
    const s = resolutionSetup(async () => Response.json(tmdbFixtures.translated));
    const waiting = await s.submit();
    await s.worker.runOnce();
    const inputId = (await s.summary(waiting)).inputs[0].id;
    const candidateId = (await s.candidates(waiting, inputId)).body.items[0].id;
    for (let i = 0; i < 20; i++) await s.submit();
    let before = s.db.serialize();
    expect((await s.api("", { inputs: [{ title: "Overflow" }] })).status).toBe(429);
    expect(s.db.serialize()).toEqual(before);
    before = s.db.serialize();
    expect(
      (await s.api(`/${waiting}/selections`, { selections: [{ inputId, candidateId }] })).status,
    ).toBe(429);
    expect(s.db.serialize()).toEqual(before);
  });

  test("stale resolution attempts cannot publish late results", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const s = resolutionSetup(async () => {
      await gate;
      return Response.json(tmdbFixtures.movies);
    });
    await s.submit();
    const running = s.worker.runOnce();
    s.db.run("UPDATE operation_attempts SET deadline_at = '2000-01-01T00:00:00Z'");
    release();
    await running;
    expect(s.db.query("SELECT count(*) n FROM resolution_candidates").get()).toEqual({ n: 0 });
  });
});
