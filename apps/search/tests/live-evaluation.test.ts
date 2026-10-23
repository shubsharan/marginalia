import { expect, test } from "bun:test";
import corpus from "./fixtures/live-corpus.json" with { type: "json" };
import { evaluate } from "./live-evaluation.ts";

test("live suite refuses execution without explicit opt-in", async () => {
  const child = Bun.spawn(
    [process.execPath, "--no-env-file", "test", "./live-acceptance.test.ts"],
    {
      cwd: import.meta.dir,
      env: { ...process.env, MARGINALIA_LIVE_ACCEPTANCE: "" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = await new Response(child.stderr).text();
  expect(await child.exited).not.toBe(0);
  expect(output).toContain("Set MARGINALIA_LIVE_ACCEPTANCE=1 explicitly.");
});

test("live relevance requires complete, run-bound human judgments and nine relevant works", () => {
  const evidence = {
    corpusHash: "fixed",
    revision: "revision",
    capturedAt: "2026-10-23T00:00:00Z",
    requestId: "request",
    policyRevision: "reviewed",
    works: corpus.works.map((work) => ({
      mediaType: work.mediaType,
      providerId: work.providerId,
      state: "sources_found",
      sources: ["https://example.com/analysis"],
    })),
  };
  const review = {
    corpusHash: "fixed",
    requestId: "request",
    reviewer: "Human",
    reviewedAt: "2026-10-23T01:00:00Z",
    judgments: corpus.works.map((work) => ({
      mediaType: work.mediaType,
      providerId: work.providerId,
      relevant: true,
      sourceUrl: "https://example.com/analysis",
      reason: "Substantive work analysis",
    })),
  };
  expect(evaluate(evidence, null, "fixed")).toBe("NOT RUN");
  expect(evaluate(evidence, review, "changed")).toBe("NOT RUN");
  expect(evaluate(evidence, { ...review, requestId: "another" }, "fixed")).toBe("NOT RUN");
  expect(evaluate(evidence, review, "fixed")).toBe("PASS");
  expect(evaluate(evidence, { ...review, reviewer: " " }, "fixed")).toBe("NOT RUN");
  expect(evaluate(evidence, { ...review, reviewedAt: "2026-10-22T00:00:00Z" }, "fixed")).toBe(
    "NOT RUN",
  );
  const [first, second] = review.judgments;
  if (!first || !second) throw new Error("Test corpus requires two works.");
  first.sourceUrl = "https://example.com/not-returned";
  expect(evaluate(evidence, review, "fixed")).toBe("NOT RUN");
  first.relevant = false;
  expect(evaluate(evidence, review, "fixed")).toBe("PASS");
  second.relevant = false;
  expect(evaluate(evidence, review, "fixed")).toBe("FAIL");
  expect(evaluate(evidence, { ...review, judgments: review.judgments.slice(1) }, "fixed")).toBe(
    "NOT RUN",
  );
  expect(evaluate({ ...evidence, works: Array(10).fill(evidence.works[0]) }, review, "fixed")).toBe(
    "NOT RUN",
  );
});
