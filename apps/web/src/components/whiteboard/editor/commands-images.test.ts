import {
  type BoardElement,
  createElement,
  readElements,
  writeElements,
} from "@margaya/whiteboard";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { UnsupportedWhiteboardImageError } from "@/lib/whiteboards/upload-whiteboard-image";
import { insertImage, pasteContent, rehomeImages } from "./commands";
import { BoardController, type ControllerOptions } from "./controller";

const controllers: BoardController[] = [];

function setup(options: Partial<ControllerOptions> = {}) {
  const doc = new Y.Doc();
  const uploadImage = vi.fn(async (file: File) => ({
    assetId: `new-${file.type}`,
    width: 40,
    height: 30,
  }));
  const controller = new BoardController({
    doc,
    awareness: null,
    readOnly: false,
    user: { id: "me", name: "Me", color: "#2563eb" },
    whiteboardId: "board-here",
    theme: "light",
    imageUrl: (id) => `/assets/${id}`,
    uploadImage,
    isPublic: false,
    ...options,
  });
  const notice = vi.fn();
  controller.callbacks = { notice };
  controllers.push(controller);
  return { doc, controller, notice, uploadImage };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.unstubAllGlobals();
});

const png = () =>
  new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

describe("pictures on a board", () => {
  it("says which files a board can hold instead of 'Nothing to paste'", async () => {
    const { doc, controller, notice, uploadImage } = setup();
    const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    const svg = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" });
    await pasteContent(controller, { text: null, files: [pdf] });
    await pasteContent(controller, { text: null, files: [svg] });
    expect(notice.mock.calls.map(([kind]) => kind)).toEqual([
      "imageType",
      "imageType",
    ]);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(readElements(doc)).toHaveLength(0);
    // The file picker's "All files" choice is refused before any upload.
    expect(await insertImage(controller, pdf, { x: 0, y: 0 })).toBe(false);
    expect(notice).toHaveBeenLastCalledWith("imageType");
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("pastes the text that comes with an unsupported file", async () => {
    const { doc, controller, notice } = setup();
    const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    await pasteContent(controller, { text: "a.pdf", files: [pdf] });
    expect(readElements(doc).map((element) => element.type)).toEqual(["text"]);
    expect(notice).not.toHaveBeenCalledWith("imageType");
  });

  it("reports a refused upload once, with the reason", async () => {
    const { controller, notice } = setup({
      uploadImage: vi.fn(async () => {
        throw new UnsupportedWhiteboardImageError();
      }),
    });
    expect(await insertImage(controller, png(), { x: 0, y: 0 })).toBe(false);
    expect(notice.mock.calls.map(([kind]) => kind)).toEqual([
      "uploading",
      "imageType",
    ]);
    notice.mockClear();
    const { controller: other, notice: otherNotice } = setup({
      uploadImage: vi.fn(async () => {
        throw new Error("storage down");
      }),
    });
    await insertImage(other, png(), { x: 0, y: 0 });
    expect(otherNotice).toHaveBeenLastCalledWith("uploadFailed");
  });

  it("takes the uploading notice down when the upload ends, and reports a failure in its place", async () => {
    const { controller, doc, notice } = setup();
    const events: string[] = [];
    notice.mockImplementation((kind: string) => {
      events.push(kind);
      return kind === "uploading" ? () => events.push("dismissed") : undefined;
    });
    expect(await insertImage(controller, png(), { x: 0, y: 0 })).toBe(true);
    expect(events).toEqual(["uploading", "dismissed"]);
    expect(readElements(doc).map((element) => element.type)).toEqual(["image"]);

    const failing = setup({
      uploadImage: vi.fn(async () => {
        throw new Error("storage down");
      }),
    });
    const failed: string[] = [];
    failing.notice.mockImplementation((kind: string) => {
      failed.push(kind);
      return kind === "uploading" ? () => failed.push("dismissed") : undefined;
    });
    expect(await insertImage(failing.controller, png(), { x: 0, y: 0 })).toBe(
      false,
    );
    expect(failed).toEqual(["uploading", "dismissed", "uploadFailed"]);
  });

  it("uploads pictures pasted from another board here, and keeps this board's own", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1]), {
          headers: { "Content-Type": "image/png" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { controller, uploadImage } = setup();
    const image = createElement("image", { assetId: "old" });
    const shape = createElement("rectangle");

    const same = await rehomeImages(controller, [image, shape], {
      sourceBoardId: "board-here",
    });
    expect(same).toEqual([image, shape]);
    expect(fetchMock).not.toHaveBeenCalled();

    const moved = await rehomeImages(controller, [image, shape], {
      sourceBoardId: "board-there",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/whiteboard/board-there/assets/old"),
      { credentials: "include" },
    );
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect((moved[0] as BoardElement & { assetId: string }).assetId).toBe(
      "new-image/png",
    );
    expect(moved[1]).toBe(shape);
  });

  it("uploads the pictures a board file carries", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { controller, uploadImage, notice } = setup();
    const image = createElement("image", { assetId: "in-file" });
    const lost = createElement("image", { assetId: "not-in-file" });
    const result = await rehomeImages(controller, [image, lost], {
      images: { "in-file": "data:image/png;base64,AAEC" },
    });
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect((result[0] as BoardElement & { assetId: string }).assetId).toBe(
      "new-image/png",
    );
    // A picture the file doesn't carry keeps its reference.
    expect(result[1]).toBe(lost);
    // The picture comes from the file itself, not over the network.
    expect(fetchMock).not.toHaveBeenCalled();
    const sent = uploadImage.mock.calls[0]?.[0] as File;
    expect(sent.type).toBe("image/png");
    expect(sent.size).toBe(3);
    expect(notice).not.toHaveBeenCalledWith("imageMissing");
  });

  it("says when a picture from another board can't come along", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gone", { status: 404 })),
    );
    const { controller, uploadImage, notice } = setup();
    const image = createElement("image", { assetId: "old" });
    const result = await rehomeImages(controller, [image], {
      sourceBoardId: "board-there",
    });
    expect(result).toEqual([image]);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith("imageMissing");
  });

  it("writes nothing for an element list without pictures", async () => {
    const { controller, doc } = setup();
    writeElements(doc, [], "seed");
    const shapes = [createElement("rectangle")];
    expect(await rehomeImages(controller, shapes, {})).toBe(shapes);
  });
});
