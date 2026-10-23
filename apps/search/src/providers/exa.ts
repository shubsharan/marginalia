import { isIP } from "node:net";
import { err, ok, Result, ResultAsync } from "neverthrow";
import { z } from "zod";
import { readBoundedJson } from "../body.ts";
import { boundedText, calendarDateSchema, LIMITS, type Config } from "../config.ts";
import type { Candidate, ProviderFailure, TmdbFetch } from "./tmdb.ts";

export type SearchSelection = Pick<Candidate, "title" | "releaseDate" | "workType">;
export type SearchFailure = ProviderFailure | { code: "provider_budget"; retryAt: null };
export type SearchResult = {
  sources: {
    ordinal: number;
    originalUrl: string;
    normalizedUrl: string;
    sourceHost: string;
    providerResultId: string | null;
    title: string | null;
    author: string | null;
    publisher: null;
    publicationDate: string | null;
    observedAt: string;
    warningCodes: string[];
  }[];
  rejections: { ordinal: number; reasonCode: string }[];
  returnedCount: number;
  limitFlags: string[];
  noticeCodes: string[];
  providerRequestId: string | null;
  metadataPolicyRevision: string;
};

const envelopeSchema = z.object({
  success: z.literal(true).optional(),
  results: z.array(z.unknown()),
  requestId: z.unknown().optional(),
  notices: z.unknown().optional(),
  warnings: z.unknown().optional(),
});
const sourceSchema = z.object({
  id: z.unknown().optional(),
  url: z.unknown().optional(),
  title: z.unknown().optional(),
  author: z.unknown().optional(),
  publishedDate: z.unknown().optional(),
  notices: z.unknown().optional(),
  warnings: z.unknown().optional(),
});
const noticeSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/)
    .max(LIMITS.maxNoticeIdChars),
});
const restrictiveNotices = new Set([
  "METADATA_RESTRICTED",
  "RETENTION_PROHIBITED",
  "DISPLAY_PROHIBITED",
  "METADATA_RETENTION_PROHIBITED",
  "METADATA_DISPLAY_PROHIBITED",
]);
const publicationDateSchema = z.union([calendarDateSchema, z.iso.datetime({ offset: true })]);
const invalidResponse: SearchFailure = { code: "provider_response_invalid", retryAt: null };

function noticeCodes(...lists: unknown[]): string[] {
  const codes = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const notice = noticeSchema.safeParse(item);
      if (notice.success) codes.add(notice.data.code);
    }
  }
  return [...codes];
}

function retryAt(response?: Response): string {
  const now = Date.now();
  const header = response?.headers.get("Retry-After");
  const date =
    header && /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header ?? "");
  return new Date(
    Number.isFinite(date) && date >= now && date <= 8.64e15 ? date : now + LIMITS.retryDelayMs,
  ).toISOString();
}

function unavailable(): SearchFailure {
  return { code: "provider_unavailable", retryAt: retryAt() };
}

function httpFailure(response: Response): SearchFailure {
  switch (response.status) {
    case 400:
      return { code: "provider_request_invalid", retryAt: null };
    case 401:
      return { code: "provider_credentials", retryAt: null };
    case 402:
      return { code: "provider_budget", retryAt: null };
    case 403:
      return { code: "provider_access", retryAt: null };
    case 429:
      return { code: "provider_rate_limit", retryAt: retryAt(response) };
    default:
      return response.status >= 500
        ? { code: "provider_unavailable", retryAt: retryAt(response) }
        : invalidResponse;
  }
}

function sourceUrl(raw: unknown): URL | null {
  const value = boundedText(LIMITS.maxUrlChars).safeParse(raw);
  if (!value.success || /[\p{Cc}\\]/u.test(value.data) || value.data !== value.data.trim())
    return null;
  const parsed = Result.fromThrowable(
    () => new URL(value.data),
    () => null,
  )();
  if (parsed.isErr()) return null;
  const url = parsed.value;
  const hostname = url.hostname.replace(/\.$/, "");
  const labels = hostname.split(".");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    isIP(hostname) !== 0 ||
    labels.length < 2 ||
    hostname.length > 253 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    !/^[a-z][a-z0-9-]*[a-z]$/.test(labels.at(-1) ?? "") ||
    /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|onion|test|invalid|example|home\.arpa)$/.test(
      hostname,
    )
  )
    return null;
  url.hash = "";
  return url.href.length <= LIMITS.maxUrlChars ? url : null;
}

export function searchQuery(selection: SearchSelection): string {
  return [
    selection.title.trim(),
    selection.releaseDate?.slice(0, 4),
    selection.workType === "film" ? "film" : "television series",
    "criticism analysis interviews themes filmmaking",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function searchSources({
  selection,
  provider,
  fetch: fetcher = fetch,
  signal,
}: {
  selection: SearchSelection;
  provider: Config["providers"]["exa"];
  fetch?: TmdbFetch;
  signal?: AbortSignal;
}): Promise<Result<SearchResult, SearchFailure>> {
  const { credential, policy } = provider;
  if (!credential) return err({ code: "provider_credentials", retryAt: null });
  if (!policy) return err({ code: "metadata_policy_missing", retryAt: null });
  const query = boundedText(2000).safeParse(searchQuery(selection));
  if (!query.success) return err({ code: "provider_request_invalid", retryAt: null });
  const timeout = AbortSignal.timeout(LIMITS.providerTimeoutMs);
  const callSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await ResultAsync.fromThrowable(fetcher, unavailable)(
    new URL("https://api.exa.ai/search"),
    {
      method: "POST",
      headers: {
        "x-api-key": credential,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: query.data, type: "auto", numResults: LIMITS.maxCandidates }),
      redirect: "error",
      signal: callSignal,
    },
  );
  if (response.isErr()) return err(response.error);
  if (!response.value.ok) {
    const cancelled = await ResultAsync.fromPromise(
      response.value.body?.cancel() ?? Promise.resolve(),
      unavailable,
    );
    return err(cancelled.isErr() ? cancelled.error : httpFailure(response.value));
  }
  const body = await readBoundedJson(response.value.body, LIMITS.providerMaxBytes);
  if (callSignal.aborted || (body.isErr() && body.error === "body_unavailable"))
    return err(unavailable());
  if (body.isErr()) return err(invalidResponse);
  const envelope = envelopeSchema.safeParse(body.value);
  if (!envelope.success) return err(invalidResponse);
  const data = envelope.data;
  const notices = noticeCodes(data.notices, data.warnings);
  if (notices.some((code) => restrictiveNotices.has(code)))
    return err({ code: "metadata_restricted", retryAt: null });
  const sources: SearchResult["sources"] = [];
  const rejections: SearchResult["rejections"] = [];
  const observedAt = new Date().toISOString();
  for (const [index, raw] of data.results.slice(0, LIMITS.maxCandidates).entries()) {
    const ordinal = index;
    const parsed = sourceSchema.safeParse(raw);
    const codes = parsed.success ? noticeCodes(parsed.data.notices, parsed.data.warnings) : [];
    if (codes.some((code) => restrictiveNotices.has(code))) {
      rejections.push({ ordinal, reasonCode: "metadata_restricted" });
      continue;
    }
    const originalUrl = parsed.success ? parsed.data.url : null;
    const url = sourceUrl(originalUrl);
    if (!parsed.success || !url || typeof originalUrl !== "string") {
      rejections.push({ ordinal, reasonCode: "invalid_source_url" });
      continue;
    }
    notices.push(...codes.filter((code) => !notices.includes(code)));
    const item = parsed.data;
    const warningCodes: string[] = [];
    function field(name: "id" | "title" | "author", max: number): string | null {
      const value = boundedText(max).safeParse(item[name]);
      if (value.success) return value.data;
      warningCodes.push(`missing_or_invalid_${name}`);
      return null;
    }
    const providerResultId = field("id", LIMITS.maxUrlChars);
    const title = field("title", LIMITS.maxMetadataTitleChars);
    const author = field("author", 300);
    const date = publicationDateSchema.safeParse(item.publishedDate);
    if (!date.success) warningCodes.push("missing_or_invalid_publishedDate");
    sources.push({
      ordinal,
      originalUrl,
      normalizedUrl: url.href,
      sourceHost: url.hostname,
      providerResultId,
      title,
      author,
      publisher: null,
      publicationDate: date.success ? date.data : null,
      observedAt,
      warningCodes,
    });
  }
  if (JSON.stringify(notices).length > 4096) return err(invalidResponse);
  const providerRequestId = boundedText(LIMITS.maxNoticeIdChars).safeParse(data.requestId);
  return ok({
    sources,
    rejections,
    returnedCount: data.results.length,
    limitFlags:
      data.results.length < LIMITS.maxCandidates
        ? []
        : data.results.length === LIMITS.maxCandidates
          ? ["result_limit_reached"]
          : ["result_limit_reached", "search_results_truncated"],
    noticeCodes: notices,
    providerRequestId: providerRequestId.success ? providerRequestId.data : null,
    metadataPolicyRevision: policy.revision,
  });
}
