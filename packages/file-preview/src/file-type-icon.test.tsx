import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FileTypeIcon, fileKindOf, fileTypeLabel } from "./file-type-icon";

afterEach(() => cleanup());

function icon(name: string, mimeType?: string, size?: number) {
  const { container } = render(
    <FileTypeIcon name={name} mimeType={mimeType} size={size} />,
  );
  return container.querySelector(".mfp-type-icon") as HTMLElement;
}

describe("FileTypeIcon", () => {
  const cases: Array<[string, string | undefined, string, string]> = [
    ["report.pdf", "application/pdf", "pdf", "PDF"],
    ["brief.docx", undefined, "word", "DOCX"],
    ["budget.xlsx", undefined, "spreadsheet", "XLSX"],
    ["deck.pptx", undefined, "presentation", "PPTX"],
    ["photo.png", "image/png", "image", "PNG"],
    ["clip.mp4", "video/mp4", "video", "MP4"],
    ["voice.mp3", "audio/mpeg", "audio", "MP3"],
    ["bundle.zip", undefined, "archive", "ZIP"],
    ["main.ts", undefined, "code", "TS"],
    ["part.stl", undefined, "model3d", "STL"],
    ["notes.txt", "text/plain", "text", "TXT"],
    ["blob.bin", "application/octet-stream", "unknown", "BIN"],
  ];

  for (const [name, mimeType, kind, badge] of cases) {
    it(`shows ${name} as ${kind}`, () => {
      const element = icon(name, mimeType);
      expect(element.dataset.kind).toBe(kind);
      expect(element.querySelector(".mfp-type-icon-badge")?.textContent).toBe(
        badge,
      );
      expect(element.querySelector("svg")).not.toBeNull();
    });
  }

  it("gives each kind its own glyph", () => {
    const glyphs = new Set(
      ["a.docx", "a.xlsx", "a.pptx", "a.png", "a.mp4", "a.mp3", "a.zip"].map(
        (name) => icon(name).querySelector("svg")?.getAttribute("class"),
      ),
    );
    expect(glyphs.size).toBe(7);
    cleanup();
  });

  it("knows common files the preview can't open", () => {
    expect(fileKindOf({ name: "old.doc" })).toBe("word");
    expect(fileKindOf({ name: "old.ppt" })).toBe("presentation");
    expect(fileKindOf({ name: "logs.tar.gz" })).toBe("archive");
    expect(fileKindOf({ name: "x", mimeType: "application/msword" })).toBe(
      "word",
    );
    expect(fileKindOf({ name: "x" })).toBe("unknown");
  });

  it("labels files without a short extension by their format", () => {
    expect(fileTypeLabel({ name: "README.markdown" })).toBe("MD");
    expect(fileTypeLabel({ name: "scan", mimeType: "application/pdf" })).toBe(
      "PDF",
    );
    expect(fileTypeLabel({ name: "photo", mimeType: "image/png" })).toBe("");
  });

  it("is decorative unless titled, and drops the badge when small", () => {
    const plain = icon("report.pdf", undefined, 20);
    expect(plain.getAttribute("aria-hidden")).toBe("true");
    expect(plain.querySelector(".mfp-type-icon-badge")).toBeNull();
    expect(plain.style.getPropertyValue("--mfp-type-size")).toBe("20px");
    cleanup();

    const { container } = render(
      <FileTypeIcon name="report.pdf" title="PDF document" />,
    );
    const titled = container.querySelector(".mfp-type-icon") as HTMLElement;
    expect(titled.getAttribute("role")).toBe("img");
    expect(titled.getAttribute("aria-label")).toBe("PDF document");
  });
});
