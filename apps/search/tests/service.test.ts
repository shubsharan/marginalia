import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../src/config.ts";
import { migrateDatabase, openDatabase } from "../src/db.ts";
import { listCandidates, requestSummary, selectCandidates, submitRequest } from "../src/search.ts";
import { startService } from "../src/server.ts";
import { createWorker } from "../src/worker.ts";
import type { TmdbFetch } from "../src/providers/tmdb.ts";

let directory: string;
let db: Database;
let config: Config;
const children: Bun.Subprocess[] = [];
const services: ReturnType<typeof startService>[] = [];
const secret = "fake-secret-must-never-be-output";
const fixture: TmdbFetch = async (url) =>
  Response.json(
    url.hostname === "api.exa.ai"
      ? { results: [{ url: "https://example.com/saved" }] }
      : { results: [{ id: 1, title: "Heat" }] },
  );

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "search-service-"));
  const databasePath = join(directory, "search.sqlite");
  migrateDatabase(databasePath);
  db = openDatabase(databasePath);
  config = loadConfig({
    env: { MARGINALIA_DB_PATH: databasePath, TMDB_READ_ACCESS_TOKEN: secret, EXA_API_KEY: secret },
  });
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
    await child.exited;
  }
  for (const service of services.splice(0)) await service.stop();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Service condition was not reached.");
    await Bun.sleep(10);
  }
}

async function freeze() {
  const id = submitRequest(db, { inputs: [{ title: "Heat", workType: "film" }] }).requestId;
  const worker = createWorker({ db, config, fetch: fixture });
  await worker.runOnce();
  const input = requestSummary(db, id).inputs[0];
  if (!input) throw new Error("Expected input.");
  const candidate = listCandidates(db, config, id, input.id).items[0];
  if (!candidate) throw new Error("Expected candidate.");
  selectCandidates(db, id, { selections: [{ inputId: input.id, candidateId: candidate.id }] });
  await worker.stop();
  return id;
}

test.each(["recovery", "claim", "publication"])(
  "fatal %s failure rejects the service lifetime and closes HTTP and SQLite",
  async (phase) => {
    if (phase === "publication") {
      await freeze();
      db.run("CREATE TRIGGER skip_source BEFORE INSERT ON sources BEGIN SELECT RAISE(IGNORE); END");
    } else {
      submitRequest(db, { inputs: [{ title: "Heat", workType: "film" }] });
      if (phase === "recovery") {
        await createWorker({ db, config, fetch: fixture }).runOnce();
        db.run("UPDATE operations SET state = 'running'");
        db.run(
          "UPDATE operation_attempts SET state = 'running', finished_at = NULL, deadline_at = '2000-01-01'",
        );
        db.run(`CREATE TRIGGER reject_recovery BEFORE UPDATE ON title_inputs
          WHEN NEW.resolution_state = 'interrupted' BEGIN SELECT RAISE(ABORT, '${secret}'); END`);
      } else {
        db.run(`CREATE TRIGGER reject_claim BEFORE INSERT ON operation_attempts
          BEGIN SELECT RAISE(ABORT, '${secret}'); END`);
      }
    }
    const service = startService({ db, config, fetch: fixture, port: 0 });
    const url = `http://127.0.0.1:${service.server.port}/health`;
    await expect(service.done).rejects.toThrow(
      phase === "publication" ? "Source identity was not saved." : secret,
    );
    expect(() => db.query("SELECT 1").get()).toThrow();
    await expect(fetch(url)).rejects.toThrow();
  },
);

test("provider failures remain operation outcomes while the service keeps serving", async () => {
  const id = submitRequest(db, { inputs: [{ title: "Heat" }] }).requestId;
  const service = startService({
    db,
    config,
    fetch: async () => new Response(null, { status: 401 }),
    port: 0,
  });
  services.push(service);
  await until(() => requestSummary(db, id).operationCounts.failed === 1);
  const response = await fetch(`http://127.0.0.1:${service.server.port}/health`);
  expect(response.status).toBe(200);
  await service.stop();
  await service.done;
});

test("recoverable publication failures roll back without ending the service", async () => {
  const id = await freeze();
  db.run(`CREATE TRIGGER reject_source BEFORE INSERT ON sources
    BEGIN SELECT RAISE(ABORT, '${secret}'); END`);
  const service = startService({ db, config, fetch: fixture, port: 0 });
  services.push(service);
  await until(() => requestSummary(db, id).operationCounts.failed === 1);
  expect(requestSummary(db, id).nextActions[0]?.errorCode).toBe("storage_unavailable");
  expect(db.query("SELECT count(*) n FROM sources").get()).toEqual({ n: 0 });
  expect((await fetch(`http://127.0.0.1:${service.server.port}/health`)).status).toBe(200);
  await service.stop();
  await service.done;
});

test("shutdown cancels active work, persists interruption, and resolves the lifetime once", async () => {
  const id = submitRequest(db, { inputs: [{ title: "Heat" }] }).requestId;
  let began = false;
  const service = startService({
    db,
    config,
    port: 0,
    fetch: async (_url, init) => {
      began = true;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error(secret)), { once: true });
      });
    },
  });
  await until(() => began);
  const first = service.stop();
  expect(service.stop()).toBe(first);
  await first;
  await service.done;
  db = openDatabase(config.databasePath);
  expect(requestSummary(db, id).operationCounts.interrupted).toBe(1);
});

test("cleanup failure still stops HTTP and closes SQLite", async () => {
  const service = startService({ db, config, fetch: fixture, port: 0 });
  const url = `http://127.0.0.1:${service.server.port}/health`;
  db.run("DROP TABLE operations");
  const done = expect(service.done).rejects.toThrow("no such table");
  await expect(service.stop()).rejects.toThrow("no such table");
  await done;
  expect(() => db.query("SELECT 1").get()).toThrow();
  await expect(fetch(url)).rejects.toThrow();
});

function cli() {
  const child = Bun.spawn(
    [process.execPath, "--no-env-file", new URL("../src/server.ts", import.meta.url).pathname],
    {
      env: { PATH: process.env.PATH, MARGINALIA_DB_PATH: config.databasePath },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  children.push(child);
  return child;
}

test("the CLI exits nonzero with sanitized diagnostics after a fatal worker failure", async () => {
  submitRequest(db, { inputs: [{ title: "Heat" }] });
  db.run(`CREATE TRIGGER reject_claim BEFORE INSERT ON operation_attempts
    BEGIN SELECT RAISE(ABORT, '${secret}'); END`);
  const child = cli();
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code).toBe(1);
  expect(stdout).toContain('"listening":');
  expect(stderr.trim()).toBe(JSON.stringify({ level: "error", code: "storage_unavailable" }));
  expect(stderr).not.toContain(secret);
  const reopened = openDatabase(config.databasePath);
  try {
    expect(reopened.query("SELECT state FROM operations").get()).toEqual({ state: "pending" });
  } finally {
    reopened.close();
  }
});

test.each(["SIGINT", "SIGTERM"] as const)(
  "the CLI handles %s with normal shutdown",
  async (signal) => {
    const child = cli();
    const reader = child.stdout.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"listening":');
    child.kill(signal);
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe("");
    reader.releaseLock();
  },
);
