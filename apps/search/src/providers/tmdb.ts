import { err, ok, ResultAsync, type Result } from "neverthrow";
import { z } from "zod";
import { boundedText, calendarDateSchema, LIMITS, type Config } from "../config.ts";
import { readBoundedJson } from "../body.ts";
import { noticeCodes, restrictiveNotices } from "./notices.ts";

const workTypeSchema = z.enum(["film", "television_series"]);
export const resolutionInputSchema = z.strictObject({
  title: z
    .string()
    .refine((value) => value.trim().length > 0 && value.trim().length <= LIMITS.maxInputTitleChars),
  year: z.int().min(LIMITS.minYear).max(LIMITS.maxYear).optional(),
  workType: workTypeSchema.optional(),
});
export type WorkType = z.infer<typeof workTypeSchema>;
export type ResolutionInput = z.infer<typeof resolutionInputSchema>;
export type TmdbFetch = (url: URL, init: RequestInit) => Promise<Response>;
type MediaType = "movie" | "tv";
export type Candidate = {
  mediaType: MediaType;
  providerId: number;
  title: string;
  originalTitle: string | null;
  workType: WorkType;
  releaseDate: string | null;
  originalLanguage: string | null;
  originCountries: string[] | null;
  retrievedAt: string;
  eligible: boolean;
  ineligibleReason: string | null;
  warningCodes: string[];
};
type EndpointCoverage = {
  mediaType: MediaType;
  returnedCount: number;
  totalPages: number | null;
  totalResults: number | null;
  retainedCount: number;
};
export type ResolutionResult = {
  candidates: Candidate[];
  endpoints: EndpointCoverage[];
  returnedCount: number;
  limitFlags: string[];
};
export type ProviderFailure =
  | {
      code:
        | "provider_credentials"
        | "provider_access"
        | "provider_request_invalid"
        | "provider_response_invalid"
        | "metadata_policy_missing"
        | "metadata_restricted";
      retryAt: null;
    }
  | { code: "provider_rate_limit" | "provider_unavailable"; retryAt: string };

const envelopeSchema = z.object({
  success: z.literal(true).optional(),
  results: z.array(z.unknown()),
  page: z.literal(1).optional(),
  total_pages: z.int().min(0).optional(),
  total_results: z.int().min(0).optional(),
  notices: z.unknown().optional(),
  warnings: z.unknown().optional(),
});
const candidateSchema = z.object({
  id: z.int().positive(),
  media_type: z.enum(["movie", "tv"]).optional(),
  adult: z.boolean().optional(),
  title: z.unknown().optional(),
  name: z.unknown().optional(),
  original_title: z.unknown().optional(),
  original_name: z.unknown().optional(),
  release_date: z.unknown().optional(),
  first_air_date: z.unknown().optional(),
  original_language: z.unknown().optional(),
  origin_country: z.unknown().optional(),
  notices: z.unknown().optional(),
  warnings: z.unknown().optional(),
});
const countriesSchema = z.array(z.string().regex(/^[A-Z]{2}$/)).max(LIMITS.maxCountries);
const invalidResponse: ProviderFailure = { code: "provider_response_invalid", retryAt: null };

function retryAt(response?: Response) {
  const now = Date.now();
  const header = response?.headers.get("Retry-After");
  const date =
    header && /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header ?? "");
  return new Date(
    Number.isFinite(date) && date >= now && date <= 8.64e15 ? date : now + LIMITS.retryDelayMs,
  ).toISOString();
}

function unavailable(): ProviderFailure {
  return { code: "provider_unavailable", retryAt: retryAt() };
}

function httpFailure(response: Response): ProviderFailure {
  switch (response.status) {
    case 401:
      return { code: "provider_credentials", retryAt: null };
    case 403:
      return { code: "provider_access", retryAt: null };
    case 400:
    case 422:
      return { code: "provider_request_invalid", retryAt: null };
    case 429:
      return { code: "provider_rate_limit", retryAt: retryAt(response) };
    default:
      return response.status >= 500
        ? { code: "provider_unavailable", retryAt: retryAt(response) }
        : invalidResponse;
  }
}

function parseCandidate({
  raw,
  mediaType,
  input,
  retrievedAt,
}: {
  raw: unknown;
  mediaType: MediaType;
  input: ResolutionInput;
  retrievedAt: string;
}): Result<Candidate | null, ProviderFailure> {
  const parsed = candidateSchema.safeParse(raw);
  if (!parsed.success) return err(invalidResponse);
  const data = parsed.data;
  if (noticeCodes(data.notices, data.warnings).some((code) => restrictiveNotices.has(code)))
    return ok(null);
  if (data.media_type !== undefined && data.media_type !== mediaType) return err(invalidResponse);
  const movie = mediaType === "movie";
  const title = boundedText(LIMITS.maxMetadataTitleChars).safeParse(data[movie ? "title" : "name"]);
  if (!title.success) return err(invalidResponse);
  if (data.adult === true) return ok(null);
  const warnings: string[] = [];
  function field(name: keyof typeof data, max: number) {
    const value = boundedText(max).safeParse(data[name]);
    if (!value.success) {
      warnings.push(`missing_or_invalid_${name}`);
      return null;
    }
    return value.data;
  }
  const dateField = movie ? "release_date" : "first_air_date";
  const date = field(dateField, 10);
  const validatedDate = calendarDateSchema.safeParse(date);
  const releaseDate = validatedDate.success ? validatedDate.data : null;
  if (date !== null && releaseDate === null) warnings.push(`invalid_${dateField}`);
  const countries = countriesSchema.safeParse(data.origin_country);
  const originCountries = !movie && countries.success ? countries.data : null;
  if (!movie && originCountries === null) warnings.push("missing_or_invalid_origin_country");
  const eligible =
    input.year === undefined ||
    (releaseDate !== null && Number(releaseDate.slice(0, 4)) === input.year);
  return ok({
    mediaType,
    providerId: data.id,
    title: title.data,
    originalTitle: field(movie ? "original_title" : "original_name", LIMITS.maxMetadataTitleChars),
    workType: movie ? "film" : "television_series",
    releaseDate,
    originalLanguage: field("original_language", LIMITS.maxLanguageChars),
    originCountries,
    retrievedAt,
    eligible,
    ineligibleReason: eligible ? null : releaseDate === null ? "year_unknown" : "year_conflict",
    warningCodes: warnings,
  });
}

export async function resolveTitle({
  input,
  provider,
  fetch: fetcher = fetch,
  signal,
}: {
  input: ResolutionInput;
  provider: Config["providers"]["tmdb"];
  fetch?: TmdbFetch;
  signal?: AbortSignal;
}): Promise<Result<ResolutionResult, ProviderFailure>> {
  const { credential, policy } = provider;
  if (!credential) return err({ code: "provider_credentials", retryAt: null });
  if (!policy) return err({ code: "metadata_policy_missing", retryAt: null });
  const types: MediaType[] =
    input.workType === "film"
      ? ["movie"]
      : input.workType === "television_series"
        ? ["tv"]
        : ["movie", "tv"];
  const endpoints: EndpointCoverage[] = [];
  const lists: Candidate[][] = [];
  let limited = false;
  for (const mediaType of types) {
    const url = new URL(`https://api.themoviedb.org/3/search/${mediaType}`);
    url.search = new URLSearchParams({
      query: input.title.trim(),
      language: "en-US",
      page: "1",
      include_adult: "false",
    }).toString();
    const timeout = AbortSignal.timeout(LIMITS.providerTimeoutMs);
    const callSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await ResultAsync.fromThrowable(fetcher, unavailable)(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${credential}`, Accept: "application/json" },
      redirect: "error",
      signal: callSignal,
    });
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
    const payload = envelopeSchema.safeParse(body.value);
    if (!payload.success) return err(invalidResponse);
    const data = payload.data;
    if (noticeCodes(data.notices, data.warnings).some((code) => restrictiveNotices.has(code)))
      return err({ code: "metadata_restricted", retryAt: null });
    const candidates: Candidate[] = [];
    const seen = new Set<number>();
    const retrievedAt = new Date().toISOString();
    for (const raw of data.results) {
      const candidate = parseCandidate({ raw, mediaType, input, retrievedAt });
      if (candidate.isErr()) return err(candidate.error);
      if (!candidate.value || seen.has(candidate.value.providerId)) continue;
      seen.add(candidate.value.providerId);
      candidates.push(candidate.value);
    }
    limited ||= (data.total_pages ?? 0) > 1 || data.results.length > LIMITS.maxCandidates;
    endpoints.push({
      mediaType,
      returnedCount: data.results.length,
      totalPages: data.total_pages ?? null,
      totalResults: data.total_results ?? null,
      retainedCount: 0,
    });
    lists.push(candidates);
  }
  const candidates: Candidate[] = [];
  const max = Math.max(...lists.map((list) => list.length));
  for (let index = 0; index < max; index++) {
    for (const list of lists) {
      const candidate = list[index];
      if (candidate) candidates.push(candidate);
    }
  }
  limited ||= candidates.length > LIMITS.maxCandidates;
  const retained = candidates.slice(0, LIMITS.maxCandidates);
  for (const endpoint of endpoints)
    endpoint.retainedCount = retained.filter((c) => c.mediaType === endpoint.mediaType).length;
  return ok({
    candidates: retained,
    endpoints,
    returnedCount: endpoints.reduce((sum, e) => sum + e.returnedCount, 0),
    limitFlags: limited ? ["resolution_limit_reached"] : [],
  });
}
