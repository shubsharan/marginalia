import { expect, test } from "bun:test";
import { readBoundedJson } from "../src/body.ts";

test("shared JSON reader accepts exact byte limits and UTF-8 split across chunks", async () => {
  const bytes = new TextEncoder().encode('{"title":"é"}');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const result = await readBoundedJson(body, bytes.byteLength);
  expect(result._unsafeUnwrap()).toEqual({ title: "é" });
  expect(body.locked).toBe(false);
});

test("shared JSON reader counts bytes and cancels oversized streams", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('"é"'));
    },
    cancel() {
      cancelled = true;
    },
  });
  expect((await readBoundedJson(body, 3))._unsafeUnwrapErr()).toBe("body_too_large");
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});

test("shared JSON reader rejects invalid UTF-8, missing bodies and failed streams without raw errors", async () => {
  expect(
    (await readBoundedJson(new Response(Uint8Array.of(34, 255, 34)).body, 3))._unsafeUnwrapErr(),
  ).toBe("malformed_json");
  expect((await readBoundedJson(null, 3))._unsafeUnwrapErr()).toBe("malformed_json");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("fake-secret"));
    },
  });
  const result = await readBoundedJson(body, 3);
  expect(result._unsafeUnwrapErr()).toBe("body_unavailable");
  expect(JSON.stringify(result)).not.toContain("fake-secret");
  expect(body.locked).toBe(false);
});
