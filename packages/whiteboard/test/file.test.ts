import { describe, expect, it } from "vitest";
import { createElement, deleteElement } from "../src/create.js";
import {
  crc32,
  embedInPng,
  extractFromPng,
  parseBoardFile,
  serializeBoard,
} from "../src/file.js";
import { isValidOrder } from "../src/order.js";
import {
  BOARD_TEMPLATE_IDS,
  isBoardTemplateId,
  TEMPLATE_LABEL_KEYS,
  templateElements,
} from "../src/templates.js";
import { parseElement } from "../src/validate.js";

/** The smallest valid PNG: a 1x1 grey pixel. */
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

function chunkTypes(png: Uint8Array): string[] {
  const types: string[] = [];
  let at = 8;
  while (at < png.length) {
    const length =
      ((png[at] << 24) |
        (png[at + 1] << 16) |
        (png[at + 2] << 8) |
        png[at + 3]) >>>
      0;
    types.push(String.fromCharCode(...png.subarray(at + 4, at + 8)));
    at += 12 + length;
  }
  return types;
}

function textChunk(keyword: string, text: string): Uint8Array {
  const data = Uint8Array.from(`${keyword}\0${text}`, (char) =>
    char.charCodeAt(0),
  );
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set([116, 69, 88, 116], 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

describe("board files", () => {
  it("round-trips elements and settings", () => {
    const elements = [
      createElement("sticky", { id: "s", text: "Hello ✓", order: "a0" }),
      createElement("arrow", { id: "a", order: "a1" }),
      deleteElement(createElement("text", { id: "gone", order: "a2" })),
    ];
    const settings = {
      background: "#000000",
      gridSize: 20,
      pattern: "grid",
      patternSize: 32,
    } as const;
    const text = serializeBoard(elements, settings);
    const parsed = JSON.parse(text);
    expect(parsed.type).toBe("margaya-board");
    expect(parsed.version).toBe(1);
    const board = parseBoardFile(text);
    expect(board?.settings).toEqual(settings);
    expect(board?.elements).toEqual(elements.slice(0, 2));
  });

  it("carries the pictures of its image elements, and only valid ones", () => {
    const picture = "data:image/png;base64,iVBORw0KGgo=";
    const elements = [
      createElement("image", { id: "i", assetId: "asset-1", order: "a0" }),
      createElement("rectangle", { id: "r", order: "a1" }),
    ];
    const text = serializeBoard(elements, undefined, {
      "asset-1": picture,
      // Not on the board, so not in the file.
      "asset-2": picture,
    });
    expect(JSON.parse(text).images).toEqual({ "asset-1": picture });
    expect(parseBoardFile(text)?.images).toEqual({ "asset-1": picture });

    // Without pictures the file keeps its old shape.
    expect(JSON.parse(serializeBoard(elements)).images).toBeUndefined();
    expect(parseBoardFile(serializeBoard(elements))?.images).toEqual({});

    const hostile = JSON.stringify({
      type: "margaya-board",
      version: 1,
      elements,
      images: {
        "asset-1": "data:image/svg+xml;base64,PHN2Zz4=",
        "asset-9": picture,
      },
    });
    expect(parseBoardFile(hostile)?.images).toEqual({});
  });

  it("validates every element and rejects foreign files", () => {
    const text = JSON.stringify({
      type: "margaya-board",
      version: 1,
      elements: [
        { type: "rectangle", id: "ok", link: "javascript:alert(1)" },
        { type: "bogus", id: "x" },
      ],
      settings: { background: "url(x)" },
    });
    const board = parseBoardFile(text);
    expect(board?.elements).toHaveLength(1);
    expect(board?.elements[0].link).toBeNull();
    expect(board?.settings.background).toBe("#ffffff");
    expect(parseBoardFile("not json")).toBeNull();
    expect(parseBoardFile("[]")).toBeNull();
    expect(
      parseBoardFile(
        JSON.stringify({ type: "other", version: 1, elements: [] }),
      ),
    ).toBeNull();
    expect(
      parseBoardFile(
        JSON.stringify({ type: "margaya-board", version: 2, elements: [] }),
      ),
    ).toBeNull();
  });
});

describe("PNG embedding", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
  });

  it("embeds before IEND and extracts the same text", () => {
    const json = serializeBoard([
      createElement("text", { text: "Größe 日本" }),
    ]);
    const png = embedInPng(TINY_PNG, json);
    expect(chunkTypes(png)).toEqual(["IHDR", "IDAT", "iTXt", "IEND"]);
    expect(extractFromPng(png)).toBe(json);
    expect(
      parseBoardFile(extractFromPng(png) as string)?.elements,
    ).toHaveLength(1);
    // The image bytes are untouched.
    expect(png.subarray(0, 8)).toEqual(TINY_PNG.subarray(0, 8));
  });

  it("replaces an earlier board chunk instead of stacking them", () => {
    const twice = embedInPng(embedInPng(TINY_PNG, "first"), "second");
    expect(chunkTypes(twice).filter((type) => type === "iTXt")).toHaveLength(1);
    expect(extractFromPng(twice)).toBe("second");
  });

  it("reads a plain tEXt chunk with the board keyword", () => {
    const iend = TINY_PNG.length - 12;
    const png = new Uint8Array(TINY_PNG.length + 64);
    const chunk = textChunk("margaya-board", '{"a":1}');
    png.set(TINY_PNG.subarray(0, iend), 0);
    png.set(chunk, iend);
    png.set(TINY_PNG.subarray(iend), iend + chunk.length);
    expect(extractFromPng(png.subarray(0, iend + chunk.length + 12))).toBe(
      '{"a":1}',
    );
  });

  it("ignores damaged chunks and returns null for non-PNG input", () => {
    const png = embedInPng(TINY_PNG, "payload");
    const damaged = png.slice();
    const at = chunkTypes(png).indexOf("iTXt");
    expect(at).toBe(2);
    // Flip one byte inside the text chunk's data.
    damaged[damaged.length - 20] ^= 0xff;
    expect(extractFromPng(damaged)).toBeNull();
    expect(extractFromPng(TINY_PNG)).toBeNull();
    expect(extractFromPng(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(extractFromPng(TINY_PNG.subarray(0, 20))).toBeNull();
    expect(() => embedInPng(new Uint8Array(10), "x")).toThrow();
  });
});

describe("templates", () => {
  it("lists the label keys for every template", () => {
    for (const id of BOARD_TEMPLATE_IDS) {
      expect(Array.isArray(TEMPLATE_LABEL_KEYS[id])).toBe(true);
      expect(isBoardTemplateId(id)).toBe(true);
    }
    expect(isBoardTemplateId("nope")).toBe(false);
    expect(TEMPLATE_LABEL_KEYS.retrospective).toContain(
      "retrospective.wentWell",
    );
  });

  it("produces valid, uniquely ordered elements that use the given labels", () => {
    for (const id of BOARD_TEMPLATE_IDS) {
      const labels = Object.fromEntries(
        TEMPLATE_LABEL_KEYS[id].map((key) => [key, `L:${key}`]),
      );
      const elements = templateElements(id, labels, { userId: "u1", now: 1 });
      if (id === "blank") {
        expect(elements).toEqual([]);
        continue;
      }
      expect(elements.length).toBeGreaterThan(0);
      const ids = new Set(elements.map((element) => element.id));
      expect(ids.size).toBe(elements.length);
      const orders = elements.map((element) => element.order);
      expect(new Set(orders).size).toBe(orders.length);
      expect([...orders].sort()).toEqual(orders);
      for (const element of elements) {
        expect(isValidOrder(element.order)).toBe(true);
        expect(parseElement(element)).toEqual(element);
        if (element.frameId) expect(ids.has(element.frameId)).toBe(true);
      }
      const text = JSON.stringify(elements);
      for (const key of TEMPLATE_LABEL_KEYS[id]) {
        expect(text).toContain(`L:${key}`);
      }
    }
  });

  it("binds flowchart arrows to their shapes and places them between", () => {
    const elements = templateElements("flowchart", {});
    const arrows = elements.filter((element) => element.type === "arrow");
    expect(arrows).toHaveLength(5);
    const shapes = new Set(elements.map((element) => element.id));
    for (const arrow of arrows) {
      if (arrow.type !== "arrow") continue;
      expect(shapes.has(arrow.startBinding?.elementId ?? "")).toBe(true);
      expect(shapes.has(arrow.endBinding?.elementId ?? "")).toBe(true);
      expect(arrow.width + arrow.height).toBeGreaterThan(0);
    }
    // Missing labels fall back to their keys.
    expect(JSON.stringify(elements)).toContain("flowchart.start");
  });

  it("offsets everything by the origin", () => {
    const base = templateElements("kanban", {});
    const moved = templateElements(
      "kanban",
      {},
      { origin: { x: 1000, y: 500 } },
    );
    expect(moved[0].x - base[0].x).toBe(1000);
    expect(moved[0].y - base[0].y).toBe(500);
  });
});
