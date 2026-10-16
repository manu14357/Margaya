import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSseBlock, streamAi } from "./stream-ai";

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("streamAi", () => {
  it("dispatches events split across chunks", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'event: meta\ndata: {"provider":"fake","model":"m"}\n\n',
        'event: delta\ndata: {"text":"Hel',
        'lo"}\n\nevent: delta\r\ndata: {"text":" there"}\r\n\r\n',
        'event: done\ndata: {"stop":"end_turn","costMicros":0}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    const onMeta = vi.fn();
    const onDone = vi.fn();
    const text = await streamAi({
      apiUrl: "http://api/api",
      path: "/ai/ask",
      body: { q: 1 },
      windowId: "w1",
      onMeta,
      onDelta: (delta) => deltas.push(delta),
      onDone,
    });
    expect(text).toBe("Hello there");
    expect(deltas).toEqual(["Hello", " there"]);
    expect(onMeta).toHaveBeenCalledWith({ provider: "fake", model: "m" });
    expect(onDone).toHaveBeenCalledWith({ stop: "end_turn", costMicros: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api/api/ai/ask",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          Accept: "text/event-stream",
          "X-Margaya-Window-Id": "w1",
        }),
      }),
    );
  });

  it("hands other events to onEvent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'event: progress\ndata: {"done":1,"total":2}\n\n',
          'event: done\ndata: {"projectId":"p"}\n\n',
        ]),
      ),
    );
    const onEvent = vi.fn();
    const onDone = vi.fn();
    await streamAi({
      apiUrl: "x",
      path: "/ai/build/apply",
      body: {},
      onEvent,
      onDone,
    });
    expect(onEvent).toHaveBeenCalledWith("progress", { done: 1, total: 2 });
    expect(onDone).toHaveBeenCalledWith({ projectId: "p" });
  });

  it("reports JSON and plain-text errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { code: "AI_BUDGET_EXCEEDED", message: "cap" },
          { status: 429 },
        ),
      ),
    );
    const onError = vi.fn();
    await streamAi({ apiUrl: "x", path: "/ai", body: {}, onError });
    expect(onError).toHaveBeenCalledWith({
      code: "AI_BUDGET_EXCEEDED",
      message: "cap",
      status: 429,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("Insufficient permissions", { status: 403 }),
      ),
    );
    await streamAi({ apiUrl: "x", path: "/ai", body: {}, onError });
    expect(onError).toHaveBeenLastCalledWith({
      code: "HTTP_403",
      message: "Insufficient permissions",
      status: 403,
    });
  });

  it("parses multi-line data", () => {
    expect(parseSseBlock("event: x\ndata: a\ndata: b")).toEqual({
      event: "x",
      data: "a\nb",
    });
    expect(parseSseBlock(": comment")).toBeNull();
  });
});
