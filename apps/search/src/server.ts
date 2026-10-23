import { Hono, type MiddlewareHandler } from "hono";
import type { Database } from "bun:sqlite";
import { LIMITS, loadConfig, providerReadiness, type Config } from "./config.ts";
import { readBoundedJson } from "./body.ts";
import { RequestError } from "./errors.ts";
import { openDatabase, StorageError } from "./db.ts";
import {
  listCandidates,
  listRequests,
  listWorks,
  listSources,
  listObservations,
  workDetail,
  sourceDetail,
  requestSummary,
  selectCandidates,
  submitRequest,
  retryOperations,
} from "./search.ts";
import { createWorker } from "./worker.ts";

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(error: unknown) {
  if (error instanceof RequestError)
    return json(
      { error: { code: error.code, message: error.message, details: error.details } },
      error.status,
    );
  const storageFailure =
    error instanceof StorageError || (error instanceof Error && error.name === "SQLiteError");
  const code =
    error instanceof StorageError
      ? error.code
      : storageFailure
        ? "storage_unavailable"
        : "internal_error";
  process.stderr.write(JSON.stringify({ level: "error", code }) + "\n");
  return json(
    { error: { code, message: "The request could not be completed.", details: [] } },
    storageFailure ? 503 : 500,
  );
}

async function readJson(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json")
    throw new RequestError(415, "unsupported_content_type", "Mutations require application/json.");
  const length = request.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    throw new RequestError(400, "invalid_body_length", "Invalid body length.");
  if (length !== null && Number(length) > LIMITS.maxBodyBytes)
    throw new RequestError(413, "body_too_large", "The JSON body exceeds 16 KiB.");
  const result = await readBoundedJson(request.body, LIMITS.maxBodyBytes);
  if (result.isOk()) return result.value;
  if (result.error === "body_too_large")
    throw new RequestError(413, "body_too_large", "The JSON body exceeds 16 KiB.");
  throw new RequestError(400, "malformed_json", "A valid JSON body is required.");
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
  const app = new Hono<{ Bindings: { host: string }; Variables: { body: unknown } }>();
  const notFound = () =>
    json(
      { error: { code: "not_found", message: "The requested route was not found.", details: [] } },
      404,
    );
  const noQuery: MiddlewareHandler = async (c, next) => {
    if (new URL(c.req.url).search)
      throw new RequestError(400, "invalid_query", "This route accepts no query parameters.");
    await next();
  };
  app.onError(errorResponse);
  app.notFound(notFound);
  app.use("*", async (c, next) => {
    const request = c.req.raw;
    if (request.headers.get("Host") !== c.env.host)
      throw new RequestError(403, "host_rejected", "The Host header is not allowed.");
    const site = request.headers.get("Sec-Fetch-Site");
    if (
      request.headers.has("Origin") ||
      (site !== null && site !== "none" && site !== "same-origin")
    )
      throw new RequestError(
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
    )
      throw new RequestError(
        400,
        "body_not_allowed",
        "This request method does not accept a body.",
      );
    if (mutation) c.set("body", await readJson(request));
    try {
      if (!db.query("SELECT version FROM schema_migrations LIMIT 1").get())
        throw new StorageError("schema_invalid");
    } catch {
      throw new StorageError("storage_unavailable");
    }
    if (request.method === "HEAD") return notFound();
    await next();
  });
  app.get("/health", () =>
    json({ storage: { ready: true }, providers: providerReadiness(config) }),
  );
  app.post("/v1/search-requests", noQuery, (c) => json(submitRequest(db, c.get("body")), 202));
  app.get("/v1/search-requests", (c) => json(listRequests(db, new URL(c.req.url).searchParams)));
  app.get("/v1/search-requests/:id", noQuery, (c) => json(requestSummary(db, c.req.param("id"))));
  app.post("/v1/search-requests/:id/selections", noQuery, (c) =>
    json(selectCandidates(db, c.req.param("id"), c.get("body"))),
  );
  app.post("/v1/search-requests/:id/retry", noQuery, (c) => {
    const result = retryOperations(db, c.req.param("id"), c.get("body"));
    return json(result, result.queuedOperationIds.length ? 202 : 200);
  });
  app.get("/v1/search-requests/:id/inputs/:inputId/candidates", noQuery, (c) =>
    json(listCandidates(db, config, c.req.param("id"), c.req.param("inputId"))),
  );
  app.get("/v1/search-requests/:id/works", (c) =>
    json(listWorks(db, config, c.req.param("id"), new URL(c.req.url).searchParams)),
  );
  app.get("/v1/search-requests/:id/sources", (c) =>
    json(listSources(db, config, c.req.param("id"), new URL(c.req.url).searchParams)),
  );
  app.get("/v1/works/:id", noQuery, (c) => json(workDetail(db, config, c.req.param("id"))));
  app.get("/v1/sources/:id", noQuery, (c) => json(sourceDetail(db, config, c.req.param("id"))));
  app.get("/v1/sources/:id/observations", (c) =>
    json(listObservations(db, config, c.req.param("id"), new URL(c.req.url).searchParams)),
  );
  return Bun.serve<undefined>({
    hostname: "127.0.0.1",
    port,
    development: false,
    // Count streamed bytes ourselves so all 413 responses use the JSON error contract.
    maxRequestBodySize: Number.MAX_SAFE_INTEGER,
    fetch: (request, server) => app.fetch(request, { host: `127.0.0.1:${server.port}` }),
    error: errorResponse,
  });
}

if (import.meta.main) {
  let db: Database | undefined;
  try {
    const config = loadConfig();
    db = openDatabase(config.databasePath);
    const server = startServer({ db, config });
    const worker = createWorker({ db, config });
    worker.start();
    const connection = db;
    let stopping = false;
    async function stop() {
      if (stopping) return;
      stopping = true;
      await worker.stop();
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
