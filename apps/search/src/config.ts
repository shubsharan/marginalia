import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));

export const LIMITS = Object.freeze({
  maxBodyBytes: 16 * 1024,
  maxInputs: 20,
  maxInputTitleChars: 300,
  minYear: 1800,
  maxYear: 2200,
  maxCandidates: 20,
  maxActiveRequests: 20,
  providerTimeoutMs: 15_000,
  providerMaxBytes: 2 * 1024 * 1024,
  operationTimeoutMs: 60_000,
  recoveryIntervalMs: 1000,
  retryDelayMs: 30_000,
  maxUrlChars: 4096,
  maxMetadataTitleChars: 500,
  maxNoticeIdChars: 128,
  maxLanguageChars: 16,
  maxCountries: 20,
});

type Provider = "tmdb" | "exa";

export const boundedText = (max: number) =>
  z.string().refine((value) => value.trim().length > 0 && value.length <= max);
export const calendarDateSchema = z.iso.date();

const metadataPolicySchema = z.strictObject({
  revision: boundedText(LIMITS.maxNoticeIdChars),
  provider: z.enum(["tmdb", "exa"]),
  reviewedAt: calendarDateSchema.refine((date) => date <= new Date().toISOString().slice(0, 10)),
  permissionBasis: boundedText(LIMITS.maxUrlChars),
});
const policyDocumentSchema = z.object({
  revision: z.unknown(),
  providers: z.record(z.string(), z.unknown()),
});

export type MetadataPolicy = z.infer<typeof metadataPolicySchema>;
type ProviderConfig = { credential: string | null; policy: MetadataPolicy | null };
export type Config = { databasePath: string; providers: Record<Provider, ProviderConfig> };

function parsePolicy(document: unknown, provider: Provider): MetadataPolicy | null {
  const parsed = policyDocumentSchema.safeParse(document);
  if (!parsed.success) return null;
  const entry = parsed.data.providers[provider];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
  const result = metadataPolicySchema.safeParse({ ...entry, revision: parsed.data.revision });
  return result.success && result.data.provider === provider ? result.data : null;
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
