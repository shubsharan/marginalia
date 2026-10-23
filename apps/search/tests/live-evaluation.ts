import { z } from "zod";
import corpus from "./fixtures/live-corpus.json" with { type: "json" };

const identity = { mediaType: z.enum(["movie", "tv"]), providerId: z.number().int().positive() };
const evidenceSchema = z.strictObject({
  corpusHash: z.string().min(1),
  revision: z.string().min(1),
  capturedAt: z.iso.datetime(),
  requestId: z.string().min(1),
  policyRevision: z.string().min(1),
  works: z
    .array(
      z.strictObject({
        ...identity,
        state: z.string(),
        sources: z.array(z.string().url()).max(20),
      }),
    )
    .length(10),
});
const judgmentsSchema = z.strictObject({
  corpusHash: z.string().min(1),
  requestId: z.string().min(1),
  reviewer: z.string().trim().min(1),
  reviewedAt: z.iso.datetime(),
  judgments: z
    .array(
      z.strictObject({
        ...identity,
        relevant: z.boolean(),
        sourceUrl: z.string().url().nullable(),
        reason: z.string().trim().min(1),
      }),
    )
    .length(10),
});

export function evaluate(evidence: unknown, judgments: unknown, corpusHash: string) {
  const saved = evidenceSchema.safeParse(evidence);
  const review = judgmentsSchema.safeParse(judgments);
  if (!saved.success || !review.success) return "NOT RUN";
  if (
    saved.data.corpusHash !== corpusHash ||
    review.data.corpusHash !== corpusHash ||
    saved.data.requestId !== review.data.requestId ||
    review.data.reviewedAt < saved.data.capturedAt
  )
    return "NOT RUN";
  let relevant = 0;
  for (const work of corpus.works) {
    const matches = (item: { mediaType: string; providerId: number }) =>
      item.mediaType === work.mediaType && item.providerId === work.providerId;
    const records = saved.data.works.filter(matches);
    const scores = review.data.judgments.filter(matches);
    const record = records[0];
    const score = scores[0];
    if (records.length !== 1 || scores.length !== 1 || !record || !score) return "NOT RUN";
    if (record.state !== "sources_found" && record.state !== "no_sources") return "FAIL";
    if (score.relevant) {
      if (!score.sourceUrl || !record.sources.includes(score.sourceUrl)) return "NOT RUN";
      relevant++;
    }
  }
  return relevant >= 9 ? "PASS" : "FAIL";
}
