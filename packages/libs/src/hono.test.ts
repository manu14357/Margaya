import { afterEach, describe, expect, it, vi } from "vitest";
import { client } from "./hono";

afterEach(() => {
  vi.unstubAllGlobals();
});

function captureFetch() {
  const calls: { headers: Record<string, string>; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      calls.push({
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body,
      });
      return new Response(JSON.stringify({ text: "" }), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

describe("typed client", () => {
  it("lets the browser set the multipart type for form uploads", async () => {
    const calls = captureFetch();
    await client.ai.speech.transcribe.$post({
      query: { workspaceId: "w1" },
      form: { audio: new File(["x"], "speech.webm", { type: "audio/webm" }) },
    });
    expect(calls[0]?.body).toBeInstanceOf(FormData);
    expect(calls[0]?.headers["Content-Type"]).toBeUndefined();
    expect(calls[0]?.headers["X-Margaya-Window-Id"]).toBeTruthy();
  });

  it("still sends JSON bodies as JSON", async () => {
    const calls = captureFetch();
    await client.ai.feedback.$post({
      json: { workspaceId: "w1", feature: "ask", rating: 1 },
    });
    expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
  });
});
