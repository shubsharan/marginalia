import type { Database } from "bun:sqlite";
import { LIMITS, loadConfig, providerReadiness, type Config } from "./config.ts";
import { openDatabase, StorageError } from "./db.ts";

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
  });
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return json({ error: { code: error.code, message: error.message, details: [] } }, error.status);
  const code = error instanceof StorageError ? error.code : "internal_error";
  process.stderr.write(JSON.stringify({ level: "error", code }) + "\n");
  return json(
    { error: { code, message: "The request could not be completed.", details: [] } },
    error instanceof StorageError ? 503 : 500,
  );
}

async function readJson(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json")
    throw new HttpError(415, "unsupported_content_type", "Mutations require application/json.");
  const length = request.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    throw new HttpError(400, "invalid_body_length", "Invalid body length.");
  if (length !== null && Number(length) > LIMITS.maxBodyBytes)
    throw new HttpError(413, "body_too_large", "The JSON body exceeds 16 KiB.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "malformed_json", "A valid JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMITS.maxBodyBytes) {
        await reader.cancel();
        throw new HttpError(413, "body_too_large", "The JSON body exceeds 16 KiB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError)
      throw new HttpError(400, "malformed_json", "A valid JSON body is required.");
    throw error;
  }
}

export function startServer({
  db,
  config,
  port = 4310,
}: {
  db: Database;
  config: Config;
  port?: number;
}) {
  return Bun.serve<undefined>({
    hostname: "127.0.0.1",
    port,
    development: false,
    // Count streamed bytes ourselves so all 413 responses use the JSON error contract.
    maxRequestBodySize: Number.MAX_SAFE_INTEGER,
    async fetch(request, server) {
      try {
        if (request.headers.get("Host") !== `127.0.0.1:${server.port}`)
          throw new HttpError(403, "host_rejected", "The Host header is not allowed.");
        const site = request.headers.get("Sec-Fetch-Site");
        if (
          request.headers.has("Origin") ||
          (site !== null && site !== "none" && site !== "same-origin")
        )
          throw new HttpError(
            403,
            "origin_rejected",
            "Browser origins and cross-site requests are not allowed.",
          );
        const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
        if (
          !mutation &&
          (request.body !== null ||
            request.headers.has("Transfer-Encoding") ||
            Number(request.headers.get("Content-Length") ?? 0) > 0)
        ) {
          throw new HttpError(
            400,
            "body_not_allowed",
            "This request method does not accept a body.",
          );
        }
        if (mutation) await readJson(request);
        if (request.method === "GET" && new URL(request.url).pathname === "/health") {
          try {
            if (!db.query("SELECT version FROM schema_migrations LIMIT 1").get())
              throw new StorageError("schema_invalid");
          } catch {
            throw new StorageError("storage_unavailable");
          }
          return json({ storage: { ready: true }, providers: providerReadiness(config) });
        }
        throw new HttpError(404, "not_found", "The requested route was not found.");
      } catch (error) {
        return errorResponse(error);
      }
    },
    error: errorResponse,
  });
}

if (import.meta.main) {
  let db: Database | undefined;
  try {
    const config = loadConfig();
    db = openDatabase(config.databasePath);
    const server = startServer({ db, config });
    const connection = db;
    let stopping = false;
    async function stop() {
      if (stopping) return;
      stopping = true;
      await server.stop(true);
      connection.close();
    }
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.stdout.write(JSON.stringify({ listening: `http://127.0.0.1:${server.port}` }) + "\n");
  } catch (error) {
    db?.close();
    errorResponse(error);
    process.exitCode = 1;
  }
}
