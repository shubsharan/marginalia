import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));

export const LIMITS = Object.freeze({
  version: 1,
  maxBodyBytes: 16 * 1024,
  maxInputs: 20,
  maxInputTitleChars: 300,
  minYear: 1800,
  maxYear: 2200,
  maxCandidates: 20,
  maxResults: 20,
  maxActiveRequests: 20,
  defaultPageSize: 25,
  maxPageSize: 100,
  providerTimeoutMs: 15_000,
  providerMaxBytes: 2 * 1024 * 1024,
  operationTimeoutMs: 60_000,
  recoveryIntervalMs: 1000,
  retryDelayMs: 30_000,
  maxUrlChars: 4096,
  maxMetadataTitleChars: 500,
  maxAuthorPublisherChars: 300,
  maxNoticeIdChars: 128,
  maxQueryChars: 2000,
  maxLanguageChars: 16,
  maxCountryChars: 2,
  maxCountries: 20,
});

const METADATA_FIELDS = {
  tmdb: [
    "id",
    "title",
    "original_title",
    "release_date",
    "original_language",
    "name",
    "original_name",
    "first_air_date",
    "origin_country",
  ],
  exa: ["id", "url", "title", "author", "publishedDate", "requestId", "noticeCodes"],
};

type Provider = keyof typeof METADATA_FIELDS;

export type MetadataPolicy = {
  revision: string;
  provider: Provider;
  reviewedAt: string;
  permissionBasis: string;
  retainedFields: string[];
  displayedFields: string[];
};

type ProviderConfig = {
  credential: string | null;
  policy: MetadataPolicy | null;
};

export type Config = {
  databasePath: string;
  providers: Record<Provider, ProviderConfig>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function fieldList(value: unknown, allowed: readonly string[]): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= allowed.length &&
    value.every((field) => typeof field === "string" && allowed.includes(field)) &&
    new Set(value).size === value.length
  );
}

function parsePolicy(document: unknown, provider: Provider): MetadataPolicy | null {
  if (
    !isObject(document) ||
    !boundedString(document.revision, LIMITS.maxNoticeIdChars) ||
    !isObject(document.providers)
  )
    return null;
  const entry = document.providers[provider];
  if (
    !isObject(entry) ||
    entry.provider !== provider ||
    typeof entry.reviewedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt) ||
    !Number.isFinite(Date.parse(entry.reviewedAt)) ||
    new Date(entry.reviewedAt).toISOString().slice(0, 10) !== entry.reviewedAt ||
    entry.reviewedAt > new Date().toISOString().slice(0, 10) ||
    !boundedString(entry.permissionBasis, LIMITS.maxUrlChars) ||
    !fieldList(entry.retainedFields, METADATA_FIELDS[provider]) ||
    !fieldList(entry.displayedFields, entry.retainedFields)
  )
    return null;
  return {
    revision: document.revision,
    provider,
    reviewedAt: entry.reviewedAt,
    permissionBasis: entry.permissionBasis,
    retainedFields: entry.retainedFields,
    displayedFields: entry.displayedFields,
  };
}

function readPolicy(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error &&
        "code" in error &&
        ["ENOENT", "EACCES", "EPERM", "EISDIR", "ENOTDIR"].includes(String(error.code)))
    )
      return null;
    throw error;
  }
}

export function loadConfig({
  env = process.env,
  policyPath = resolve(APP_DIRECTORY, "metadata-policy.json"),
}: {
  env?: Record<string, string | undefined>;
  policyPath?: string;
} = {}): Config {
  const document = readPolicy(policyPath);
  return {
    databasePath: resolve(APP_DIRECTORY, env.MARGINALIA_DB_PATH?.trim() || "data/search.sqlite"),
    providers: {
      tmdb: {
        credential: env.TMDB_READ_ACCESS_TOKEN?.trim() || null,
        policy: parsePolicy(document, "tmdb"),
      },
      exa: { credential: env.EXA_API_KEY?.trim() || null, policy: parsePolicy(document, "exa") },
    },
  };
}

export function providerReadiness(config: Config) {
  function readiness({ credential, policy }: ProviderConfig) {
    const reasons: ("provider_credentials" | "metadata_policy_missing")[] = [];
    if (!credential) reasons.push("provider_credentials");
    if (!policy) reasons.push("metadata_policy_missing");
    return {
      credentialsConfigured: Boolean(credential),
      metadataPolicyReady: policy !== null,
      ready: reasons.length === 0,
      reasons,
    };
  }
  return { tmdb: readiness(config.providers.tmdb), exa: readiness(config.providers.exa) };
}
