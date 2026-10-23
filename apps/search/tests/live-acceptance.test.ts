import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { APP_DIRECTORY, loadConfig, providerReadiness } from "../src/config.ts";
import { migrateDatabase, openDatabase } from "../src/db.ts";
import {
  listCandidates,
  listObservations,
  listSources,
  listWorks,
  requestSummary,
  selectCandidates,
  submitRequest,
} from "../src/search.ts";
import { createWorker } from "../src/worker.ts";
import corpus from "./fixtures/live-corpus.json" with { type: "json" };
import { evaluate } from "./live-evaluation.ts";

const corpusPath = join(APP_DIRECTORY, "tests/fixtures/live-corpus.json");
const corpusBytes = readFileSync(corpusPath);
const corpusHash = new Bun.CryptoHasher("sha256").update(corpusBytes).digest("hex");

test("opt-in live capture and human relevance evaluation", async () => {
  expect(
    process.env.MARGINALIA_LIVE_ACCEPTANCE,
    "Set MARGINALIA_LIVE_ACCEPTANCE=1 explicitly.",
  ).toBe("1");
  const directory = process.env.MARGINALIA_LIVE_RUN_DIR;
  if (!directory || !isAbsolute(directory))
    throw new Error("Set an absolute MARGINALIA_LIVE_RUN_DIR.");
  const mode = process.env.MARGINALIA_LIVE_MODE;
  if (mode !== "capture" && mode !== "score")
    throw new Error("Set MARGINALIA_LIVE_MODE=capture or score.");
  const config = loadConfig();
  for (const [provider, status] of Object.entries(providerReadiness(config))) {
    if (!status.metadataPolicyReady || (mode === "capture" && !status.credentialsConfigured))
      throw new Error(
        `Live acceptance blocked: ${provider} needs reviewed policy${mode === "capture" ? " and credentials" : ""}.`,
      );
  }
  if (mode === "score") {
    const evidence: unknown = JSON.parse(readFileSync(join(directory, "evidence.json"), "utf8"));
    const judgments: unknown = JSON.parse(readFileSync(join(directory, "judgments.json"), "utf8"));
    expect(
      evaluate(evidence, judgments, corpusHash),
      "SC-002 requires complete human review of this capture.",
    ).toBe("PASS");
    return;
  }
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: APP_DIRECTORY, encoding: "utf8" }).trim();
  expect(
    execFileSync("git", ["show", "HEAD:apps/search/tests/fixtures/live-corpus.json"], {
      cwd: APP_DIRECTORY,
    }).equals(corpusBytes),
  ).toBe(true);
  const implementation = new Bun.CryptoHasher("sha256");
  const paths = [
    "package.json",
    "metadata-policy.json",
    ...new Bun.Glob("{src,tests,migrations}/**/*.{ts,json,sql}").scanSync(APP_DIRECTORY),
  ].sort();
  for (const path of paths)
    implementation
      .update(path)
      .update("\0")
      .update(readFileSync(join(APP_DIRECTORY, path)))
      .update("\0");
  implementation.update(readFileSync(join(APP_DIRECTORY, "../../bun.lock")));
  const revision = `${git("rev-parse", "HEAD")}+snapshot:${implementation.digest("hex")}`;
  mkdirSync(directory);
  const path = join(directory, "search.sqlite");
  migrateDatabase(path);
  const db = openDatabase(path);
  const worker = createWorker({ db, config });
  const capturedAt = new Date().toISOString();
  const { requestId } = submitRequest(db, {
    inputs: corpus.works.map(({ title, year, workType }) => ({ title, year, workType })),
  });
  try {
    // Drive the production serial worker without introducing timing-dependent polling.
    while (await worker.runOnce()) {
      /* bounded by the ten inputs and ten selected works */
    }
    const summary = requestSummary(db, requestId);
    const selections = summary.inputs.map((input, index) => {
      const intended = corpus.works[index];
      if (!intended) throw new Error("Corpus/input mismatch.");
      const candidate = listCandidates(db, config, requestId, input.id).items.find(
        (item) =>
          item.eligible &&
          item.providerMediaType === intended.mediaType &&
          item.providerId === intended.providerId,
      );
      if (!candidate)
        throw new Error(
          `Expected identity absent for corpus position ${index}. Inspect snapshot.json.`,
        );
      return { inputId: input.id, candidateId: candidate.id };
    });
    expect(summary.distinctWorkCount).toBe(0);
    selectCandidates(db, requestId, { selections });
    while (await worker.runOnce()) {
      /* one call per distinct selected work */
    }
    const final = requestSummary(db, requestId);
    const works = listWorks(db, config, requestId, new URLSearchParams({ limit: "100" })).items;
    const evidence = {
      corpusHash,
      revision,
      capturedAt,
      requestId,
      policyRevision: config.providers.tmdb.policy?.revision,
      works: works.map((work) => ({
        mediaType: work.selectionSnapshot.providerMediaType,
        providerId: work.selectionSnapshot.providerId,
        state: final.coverage.find((item) => item.workId === work.id)?.state,
        sources: listSources(
          db,
          config,
          requestId,
          new URLSearchParams({ workId: work.id, limit: "100" }),
        ).items.map((source) => source.url),
      })),
    };
    writeFileSync(join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
    writeFileSync(
      join(directory, "judgments.json"),
      JSON.stringify(
        {
          corpusHash,
          requestId,
          reviewer: null,
          reviewedAt: null,
          judgments: corpus.works.map(({ mediaType, providerId }) => ({
            mediaType,
            providerId,
            relevant: null,
            sourceUrl: null,
            reason: null,
          })),
        },
        null,
        2,
      ),
    );
    expect(works).toHaveLength(10);
    expect(final.operationCounts.failed + final.operationCounts.interrupted).toBe(0);
  } finally {
    try {
      await worker.stop();
      const sources = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const page = listSources(db, config, requestId, query);
        for (const source of page.items)
          sources.push({
            ...source,
            observations: listObservations(
              db,
              config,
              source.id,
              new URLSearchParams({ requestId, limit: "100" }),
            ).items,
          });
        cursor = page.nextCursor;
      } while (cursor);
      writeFileSync(
        join(directory, "snapshot.json"),
        JSON.stringify(
          {
            corpusHash,
            revision,
            capturedAt,
            finishedAt: new Date().toISOString(),
            summary: requestSummary(db, requestId),
            sources,
          },
          null,
          2,
        ),
      );
    } finally {
      db.close();
    }
  }
  throw new Error(
    "Capture saved. SC-002 NOT RUN until a human fills judgments.json and runs score mode. No paid calls occur in score mode.",
  );
}, 600_000);
