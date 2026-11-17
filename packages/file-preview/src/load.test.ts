import { afterEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_LIMITS } from "./limits";
import {
  decodeText,
  looksBinary,
  PreviewLoadError,
  PreviewTooLargeError,
  readSource,
} from "./load";

afterEach(() => vi.unstubAllGlobals());

const bytes = (length: number) => new Uint8Array(length).fill(97);

function streamResponse(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
) {
  let pulled = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulled++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel,
  });
  return { response: new Response(body, { headers }), cancel };
}

describe("readSource", () => {
  const signal = new AbortController().signal;

  it("prefers load() over the URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await readSource(
      {
        name: "a.txt",
        url: "https://example.com/a",
        load: async () => bytes(4).buffer,
      },
      signal,
      { maxBytes: 10 },
    );
    expect(result.bytes.byteLength).toBe(4);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the requested credentials", async () => {
    const fetchMock = vi.fn(async () => new Response("hello"));
    vi.stubGlobal("fetch", fetchMock);
    await readSource(
      { name: "a.txt", url: "https://api.test/a", credentials: "include" },
      signal,
      { maxBytes: 10 },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/a",
      expect.objectContaining({ credentials: "include", signal }),
    );
  });

  it("refuses a file whose declared length is over the limit without reading it", async () => {
    const { response, cancel } = streamResponse([bytes(5)], {
      "content-length": "500",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    await expect(
      readSource({ name: "a.pdf", url: "https://api.test/a" }, signal, {
        maxBytes: 100,
      }),
    ).rejects.toBeInstanceOf(PreviewTooLargeError);
    expect(cancel).toHaveBeenCalled();
  });

  it("stops streaming as soon as the limit is passed", async () => {
    const { response, cancel } = streamResponse([
      bytes(60),
      bytes(60),
      bytes(60),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    await expect(
      readSource({ name: "a.pdf", url: "https://api.test/a" }, signal, {
        maxBytes: 100,
      }),
    ).rejects.toBeInstanceOf(PreviewTooLargeError);
    expect(cancel).toHaveBeenCalled();
  });

  it("returns the first part of a text file instead, marked truncated", async () => {
    const { response } = streamResponse([bytes(60), bytes(60), bytes(60)]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const result = await readSource(
      { name: "a.log", url: "https://api.test/a" },
      signal,
      { maxBytes: 100, truncate: true },
    );
    expect(result.truncated).toBe(true);
    expect(result.bytes.byteLength).toBe(100);
  });

  it("checks a loaded Blob's size before reading it", async () => {
    const blob = new Blob([bytes(300)]);
    await expect(
      readSource({ name: "a.zip", load: async () => blob }, signal, {
        maxBytes: 100,
      }),
    ).rejects.toBeInstanceOf(PreviewTooLargeError);
  });

  it("reports HTTP failures and failing loaders as load errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 403 })),
    );
    await expect(
      readSource({ name: "a.pdf", url: "https://api.test/a" }, signal, {
        maxBytes: 100,
      }),
    ).rejects.toBeInstanceOf(PreviewLoadError);
    await expect(
      readSource(
        {
          name: "a.pdf",
          load: async () => {
            throw new Error("gone");
          },
        },
        signal,
        { maxBytes: 100 },
      ),
    ).rejects.toBeInstanceOf(PreviewLoadError);
    await expect(
      readSource({ name: "a.pdf" }, signal, { maxBytes: 1 }),
    ).rejects.toBeInstanceOf(PreviewLoadError);
  });
});

describe("limits", () => {
  it("gives every kind a limit, streaming kinds none and unknown zero", () => {
    expect(PREVIEW_LIMITS.video.maxBytes).toBe(Number.POSITIVE_INFINITY);
    expect(PREVIEW_LIMITS.unknown.maxBytes).toBe(0);
    expect(PREVIEW_LIMITS.text.truncate).toBe(true);
    expect(PREVIEW_LIMITS.pdf.truncate).toBeFalsy();
  });
});

describe("text helpers", () => {
  it("decodes UTF-8 and UTF-16 with a byte order mark", () => {
    expect(decodeText(new TextEncoder().encode("héllo"))).toBe("héllo");
    expect(
      decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])),
    ).toBe("hi");
  });

  it("calls bytes with NULs binary", () => {
    expect(looksBinary(new Uint8Array([1, 0, 2]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode("plain text"))).toBe(false);
  });
});
