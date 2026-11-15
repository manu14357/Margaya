import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  UnsupportedWhiteboardImageError,
  uploadWhiteboardImage,
} from "./upload-whiteboard-image";

const m = vi.hoisted(() => ({
  createUpload: vi.fn(),
  finalize: vi.fn(),
}));

vi.mock("@/fetchers/whiteboard/whiteboard-assets", () => ({
  createWhiteboardAssetUpload: m.createUpload,
  finalizeWhiteboardAsset: m.finalize,
}));

function png(size = 4) {
  return new File([new Uint8Array(size)], "diagram.png", {
    type: "image/png",
  });
}

beforeEach(() => {
  m.createUpload.mockReset();
  m.finalize.mockReset();
});

describe("uploadWhiteboardImage", () => {
  it("asks for an upload, PUTs the bytes, then finalizes", async () => {
    m.createUpload.mockResolvedValue({
      assetId: "a1",
      upload: {
        uploadUrl: "https://storage.test/put",
        headers: { "Content-Type": "image/png" },
      },
    });
    m.finalize.mockResolvedValue({ id: "a1", width: 640, height: 480 });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null));
    const file = png();

    const result = await uploadWhiteboardImage("wb1", file, {
      fetchImpl,
      measure: async () => ({ width: 641.4, height: 480 }),
    });

    expect(m.createUpload).toHaveBeenCalledWith("wb1", {
      filename: "diagram.png",
      contentType: "image/png",
      size: 4,
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://storage.test/put", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: file,
    });
    expect(m.finalize).toHaveBeenCalledWith("wb1", "a1", {
      contentType: "image/png",
      size: 4,
      width: 641,
      height: 480,
    });
    expect(result).toEqual({ assetId: "a1", width: 640, height: 480 });
  });

  it("falls back to the browser's size when the API has none", async () => {
    m.createUpload.mockResolvedValue({
      assetId: "a1",
      upload: { uploadUrl: "https://storage.test/put", headers: {} },
    });
    m.finalize.mockResolvedValue({ id: "a1", width: null, height: null });
    const result = await uploadWhiteboardImage("wb1", png(), {
      fetchImpl: vi.fn().mockResolvedValue(new Response(null)),
      measure: async () => ({ width: 10, height: 20 }),
    });
    expect(result).toEqual({ assetId: "a1", width: 10, height: 20 });
  });

  it("refuses SVG and other types before asking the API", async () => {
    const svg = new File(["<svg/>"], "x.svg", { type: "image/svg+xml" });
    await expect(uploadWhiteboardImage("wb1", svg)).rejects.toBeInstanceOf(
      UnsupportedWhiteboardImageError,
    );
    expect(m.createUpload).not.toHaveBeenCalled();
  });

  it("does not finalize when storage refuses the bytes", async () => {
    m.createUpload.mockResolvedValue({
      assetId: "a1",
      upload: { uploadUrl: "https://storage.test/put", headers: {} },
    });
    await expect(
      uploadWhiteboardImage("wb1", png(), {
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(null, { status: 403 })),
        measure: async () => null,
      }),
    ).rejects.toThrow();
    expect(m.finalize).not.toHaveBeenCalled();
  });
});
