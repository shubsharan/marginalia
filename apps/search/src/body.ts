import { err, Result } from "neverthrow";

type BodyFailure = "body_too_large" | "body_unavailable" | "malformed_json";

export async function readBoundedJson(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Result<unknown, BodyFailure>> {
  if (!body) return err("malformed_json");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return err("body_too_large");
      }
      chunks.push(value);
    }
  } catch {
    return err("body_unavailable");
  } finally {
    reader.releaseLock();
  }
  return Result.fromThrowable(
    (): unknown =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))),
    (): BodyFailure => "malformed_json",
  )();
}
