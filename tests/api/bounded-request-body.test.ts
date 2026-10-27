import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { boundedRequestBody } from "../../apps/api/src/utils/bounded-request-body";

function app(maxBytes: number) {
  const hono = new Hono();
  hono.onError((error, c) =>
    error instanceof HTTPException
      ? c.text(error.message, error.status)
      : c.text("boom", 500),
  );
  hono.post("/", boundedRequestBody(maxBytes), async (c) =>
    c.text(await c.req.text()),
  );
  return hono;
}

/** A request body streamed in the given chunks, without a length header. */
function chunked(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function post(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("http://local/", {
    method: "POST",
    body,
    headers,
    // Node needs this for streamed request bodies.
    duplex: "half",
  } as RequestInit);
}

describe("boundedRequestBody", () => {
  it("passes a small body through unchanged", async () => {
    const res = await app(1024).request(post("hello"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("accepts a body exactly at the limit", async () => {
    const res = await app(5).request(post("12345"));
    expect(await res.text()).toBe("12345");
  });

  it("reassembles many small chunks past the first buffer size", async () => {
    const parts = Array.from({ length: 3000 }, (_, i) =>
      `${i % 10}`.repeat(40),
    );
    const res = await app(1024 * 1024).request(post(chunked(parts)));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(parts.join(""));
  });

  it("refuses a chunked body over the limit", async () => {
    const res = await app(100).request(
      post(chunked(["a".repeat(60), "b".repeat(60)])),
    );
    expect(res.status).toBe(413);
  });

  it("refuses a declared length over the limit before reading", async () => {
    const res = await app(10).request(
      post("0123456789abc", { "content-length": "13" }),
    );
    expect(res.status).toBe(413);
  });

  it("bounds a body larger than a too-small declared length", async () => {
    const res = await app(50).request(
      post(chunked(["x".repeat(40), "y".repeat(40)]), {
        "content-length": "4",
      }),
    );
    expect(res.status).toBe(413);
  });
});
