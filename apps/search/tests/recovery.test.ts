import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIMITS, type Config } from "../src/config.ts";
import { migrateDatabase, openDatabase } from "../src/db.ts";
import { listCandidates, requestSummary, selectCandidates, submitRequest } from "../src/search.ts";
import { startServer } from "../src/server.ts";
import { createWorker } from "../src/worker.ts";
import type { TmdbFetch } from "../src/providers/tmdb.ts";

let directory: string;
let db: Database;
let config: Config;
const children: Bun.Subprocess[] = [];
const stops: (() => Promise<unknown>)[] = [];
const releases: (() => void)[] = [];
const results = { results: [{ url: "https://example.com/saved" }] };
const fixtureFetch: TmdbFetch = async (url) =>
  Response.json(
    url.hostname === "api.exa.ai"
      ? results
      : {
          results: [
            { id: Number(url.searchParams.get("query")), title: url.searchParams.get("query") },
          ],
        },
  );

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "search-recovery-"));
  const path = join(directory, "search.sqlite");
  migrateDatabase(path);
  db = openDatabase(path);
  const approval = {
    revision: "test-only",
    reviewedAt: "2026-01-01",
    permissionBasis: "fixture only",
  };
  config = {
    databasePath: path,
    providers: {
      tmdb: { credential: "fake-token", policy: { ...approval, provider: "tmdb" } },
      exa: { credential: "fake-key", policy: { ...approval, provider: "exa" } },
    },
  };
});

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
    await child.exited;
  }
  for (const stop of stops.splice(0)) await stop();
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Recovery condition was not reached");
    await Bun.sleep(10);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  releases.push(resolve);
  return { promise, resolve };
}

function worker(fetch: TmdbFetch = fixtureFetch) {
  const instance = createWorker({ db, config, fetch });
  stops.push(() => instance.stop());
  return instance;
}

function api() {
  const server = startServer({ db, config, port: 0 });
  stops.push(() => server.stop(true));
  return async (id: string, body: unknown = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}/v1/search-requests/${id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
}

async function frozen() {
  const id = submitRequest(db, {
    inputs: [
      { title: "1", workType: "film" },
      { title: "2", workType: "film" },
    ],
  }).requestId;
  const instance = worker();
  await instance.runOnce();
  await instance.runOnce();
  const selections = requestSummary(db, id).inputs.map((input) => {
    const candidate = listCandidates(db, config, id, input.id).items[0];
    if (!candidate) throw new Error("Expected candidate");
    return { inputId: input.id, candidateId: candidate.id };
  });
  selectCandidates(db, id, { selections });
  await instance.stop();
  return id;
}

test("child crash preserves committed results, resumes pending work, and requires retry after the original deadline", async () => {
  const id = await frozen();
  await worker().runOnce();
  const saved = db.query("SELECT * FROM source_observations").all();
  let calls = 0;
  const gate = deferred();
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      calls++;
      await gate.promise;
      return Response.json(results);
    },
  });
  stops.push(async () => {
    gate.resolve();
    await provider.stop(true);
  });
  const workerUrl = new URL("../src/worker.ts", import.meta.url).href;
  const dbUrl = new URL("../src/db.ts", import.meta.url).href;
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "--eval",
      `
    import { openDatabase } from ${JSON.stringify(dbUrl)};
    import { createWorker } from ${JSON.stringify(workerUrl)};
    const config = JSON.parse(process.argv[1]);
    const db = openDatabase(config.databasePath);
    const worker = createWorker({ db, config, fetch: (_url, init) => fetch(process.argv[2], init) });
    worker.start();
  `,
      JSON.stringify(config),
      `http://127.0.0.1:${provider.port}`,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  children.push(child);
  await until(() => calls === 1);
  const original = db
    .query<{ id: string; deadline_at: string }, []>(
      "SELECT id, deadline_at FROM operation_attempts WHERE state = 'running'",
    )
    .get();
  if (!original) throw new Error("Expected running attempt");
  expect(Date.parse(original.deadline_at) - Date.now()).toBeGreaterThan(55_000);
  child.kill("SIGKILL");
  expect(await child.exited).not.toBe(0);
  expect(await new Response(child.stderr).text()).toBe("");
  children.splice(children.indexOf(child), 1);
  gate.resolve();
  for (const stop of stops.splice(0)) await stop();
  db.close();
  db = openDatabase(config.databasePath);
  expect(db.query("SELECT * FROM source_observations").all()).toEqual(saved);
  let resumedCalls = 0;
  const resumed = worker(async (url, init) => {
    resumedCalls++;
    return fixtureFetch(url, init);
  });
  resumed.start();
  expect(requestSummary(db, id).status).toBe("searching");
  expect(resumedCalls).toBe(0);
  // Advance the persisted deadline after proving startup respects the original 60-second lease.
  db.run("UPDATE operation_attempts SET deadline_at = ? WHERE id = ?", [
    new Date(Date.now() - 1).toISOString(),
    original.id,
  ]);
  expect(requestSummary(db, id).coverage[1]?.state).toBe("interrupted");
  await until(
    () =>
      requestSummary(db, id).operationCounts.interrupted === 1 &&
      db.query("SELECT 1 FROM operations WHERE state = 'interrupted'").get() !== null,
  );
  expect(requestSummary(db, id).status).toBe("partial");
  expect(resumedCalls).toBe(0);
  const retry = api();
  expect((await retry(id)).status).toBe(202);
  await until(() => requestSummary(db, id).status === "completed");
  await resumed.stop();
  expect(resumedCalls).toBe(1);
  expect(db.query("SELECT * FROM source_observations ORDER BY seq LIMIT 1").all()).toEqual(saved);
  expect(
    db.query("SELECT state, error_code FROM operation_attempts WHERE id = ?").get(original.id),
  ).toEqual({ state: "interrupted", error_code: "operation_interrupted" });
  const pending = submitRequest(db, { inputs: [{ title: "3", workType: "film" }] }).requestId;
  const next = worker();
  next.start();
  await until(() => requestSummary(db, pending).status === "needs_input");
  await next.stop();
  expect(requestSummary(db, id).status).toBe("completed");
}, 10_000);

test.each(["resolution", "search"] as const)(
  "startup sweep recovers expired %s without automatic retry",
  async (kind) => {
    const id =
      kind === "search"
        ? await frozen()
        : submitRequest(db, { inputs: [{ title: "1", workType: "film" }] }).requestId;
    const gate = deferred();
    const old = worker(async (url, init) => {
      await gate.promise;
      return fixtureFetch(url, init);
    });
    const active = old.runOnce();
    db.run("UPDATE operation_attempts SET deadline_at = ? WHERE state = 'running'", [
      new Date(Date.now() - 1).toISOString(),
    ]);
    const recovery = worker();
    recovery.start();
    await until(
      () =>
        db.query("SELECT 1 FROM operations WHERE state = 'interrupted'").get() !== null &&
        db.query("SELECT 1 FROM operations WHERE state = 'running'").get() === null,
    );
    await recovery.stop();
    expect(
      requestSummary(db, id).nextActions.some((a) => a.errorCode === "operation_interrupted"),
    ).toBe(true);
    gate.resolve();
    await active;
    expect(
      db.query("SELECT count(*) n FROM operation_attempts WHERE state = 'interrupted'").get(),
    ).toEqual({ n: 1 });
  },
);

for (const kind of ["resolution", "search"] as const) {
  test.each([false, true])(
    `surviving expired ${kind} cannot publish late success or failure, failure=%s`,
    async (failure) => {
      const id =
        kind === "search"
          ? await frozen()
          : submitRequest(db, { inputs: [{ title: "1", workType: "film" }] }).requestId;
      const gate = deferred();
      const old = worker(async (url, init) => {
        await gate.promise;
        return failure
          ? new Response(null, { status: 401 })
          : kind === "search"
            ? Response.json({ results: [{ url: "https://example.com/stale" }] })
            : fixtureFetch(url, init);
      });
      const active = old.runOnce();
      const operation = db
        .query<{ id: string }, []>("SELECT id FROM operations WHERE state = 'running'")
        .get();
      if (!operation) throw new Error("Expected active operation");
      db.run("UPDATE operation_attempts SET deadline_at = ? WHERE state = 'running'", [
        new Date(Date.now() - 1).toISOString(),
      ]);
      const newer = worker();
      await newer.runOnce();
      const retry = api();
      expect((await retry(id, { operationIds: [operation.id] })).status).toBe(202);
      await newer.runOnce();
      const snapshot = db.serialize();
      gate.resolve();
      await active;
      expect(db.serialize()).toEqual(snapshot);
      expect(
        db
          .query(
            "SELECT attempt_number, state FROM operation_attempts WHERE operation_id = ? ORDER BY attempt_number",
          )
          .all(operation.id),
      ).toEqual([
        { attempt_number: 1, state: "interrupted" },
        { attempt_number: 2, state: "succeeded" },
      ]);
    },
  );
}

test("retry closes an expired lease atomically before the next sweep", async () => {
  const id = submitRequest(db, { inputs: [{ title: "1", workType: "film" }] }).requestId;
  const gate = deferred();
  const old = worker(async (url, init) => {
    await gate.promise;
    return fixtureFetch(url, init);
  });
  const active = old.runOnce();
  const operation = db
    .query<{ id: string }, []>("SELECT id FROM operations WHERE state = 'running'")
    .get();
  if (!operation) throw new Error("Expected running operation");
  const retry = api();
  expect((await retry(id, { operationIds: [operation.id] })).status).toBe(409);
  db.run("UPDATE operation_attempts SET deadline_at = ? WHERE state = 'running'", [
    new Date(Date.now() - 1).toISOString(),
  ]);
  const before = db.serialize();
  expect((await retry(id, { operationIds: [operation.id, "missing"] })).status).toBe(404);
  expect(db.serialize()).toEqual(before);
  expect((await retry(id, { operationIds: [operation.id] })).status).toBe(202);
  expect(db.query("SELECT state FROM operation_attempts").get()).toEqual({ state: "interrupted" });
  expect(db.query("SELECT state FROM operations").get()).toEqual({ state: "pending" });
  expect(requestSummary(db, id).inputs[0]?.state).toBe("pending");
  await worker().runOnce();
  gate.resolve();
  await active;
  expect(requestSummary(db, id).status).toBe("needs_input");
});

test.each([false, true])("graceful cancellation closes resolution, expired=%s", async (expired) => {
  const id = submitRequest(db, { inputs: [{ title: "1", workType: "film" }] }).requestId;
  const active = worker(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
      }),
  );
  const run = active.runOnce();
  if (expired)
    db.run("UPDATE operation_attempts SET deadline_at = ? WHERE state = 'running'", [
      new Date(Date.now() - 1).toISOString(),
    ]);
  await active.stop();
  await run;
  expect(requestSummary(db, id)).toMatchObject({
    status: "blocked",
    operationCounts: { interrupted: 1 },
  });
  expect(LIMITS.recoveryIntervalMs).toBe(1000);
  expect(db.query("SELECT state FROM operation_attempts").get()).toEqual({ state: "interrupted" });
});
