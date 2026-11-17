import { describe, expect, it } from "vitest";
import type { FileKind } from "./detect";
import {
  deliveryOf,
  getPreviewRenderer,
  PreviewRendererRegistry,
} from "./registry";

const KINDS: FileKind[] = [
  "pdf",
  "word",
  "spreadsheet",
  "csv",
  "presentation",
  "image",
  "svg",
  "markdown",
  "text",
  "code",
  "html",
  "video",
  "audio",
  "archive",
  "model3d",
];

describe("PreviewRendererRegistry", () => {
  it("has a lazy renderer for every kind but unknown", () => {
    for (const kind of KINDS) {
      const entry = getPreviewRenderer(kind);
      expect(entry, kind).not.toBeNull();
      expect(typeof entry?.preload).toBe("function");
      const component = entry?.Component as unknown as
        | { $$typeof: symbol }
        | undefined;
      expect(component?.$$typeof).toBe(Symbol.for("react.lazy"));
    }
    expect(getPreviewRenderer("unknown")).toBeNull();
  });

  it("shares one renderer between related kinds", () => {
    expect(PreviewRendererRegistry.csv).toBe(
      PreviewRendererRegistry.spreadsheet,
    );
    expect(PreviewRendererRegistry.audio).toBe(PreviewRendererRegistry.video);
  });

  it("loads a renderer module once, with a component as default export", async () => {
    const entry = getPreviewRenderer("text");
    const first = entry?.preload();
    expect(entry?.preload()).toBe(first);
    const module = await first;
    expect(typeof module?.default).toBe("function");
  });

  it("streams media and pictures from the URL and reads everything else", () => {
    expect(deliveryOf("video")).toBe("url");
    expect(deliveryOf("audio")).toBe("url");
    expect(deliveryOf("image")).toBe("url");
    expect(deliveryOf("svg")).toBe("bytes");
    expect(deliveryOf("pdf")).toBe("bytes");
    expect(deliveryOf("unknown")).toBe("none");
  });
});
