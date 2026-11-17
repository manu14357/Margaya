import { describe, expect, it } from "vitest";
import { detectFileType, fileExtension } from "./detect";

describe("detectFileType", () => {
  const cases: Array<[string, string | undefined, string, string?]> = [
    ["Report.PDF", undefined, "pdf"],
    ["brief.docx", "application/octet-stream", "word"],
    ["budget.xlsx", undefined, "spreadsheet"],
    ["legacy.xls", undefined, "spreadsheet"],
    ["sheet.ods", undefined, "spreadsheet"],
    ["data.csv", undefined, "csv"],
    ["data.tsv", undefined, "csv"],
    ["deck.pptx", undefined, "presentation"],
    ["photo.jpeg", undefined, "image"],
    ["drawing.svg", undefined, "svg"],
    ["README.md", undefined, "markdown"],
    ["notes.txt", undefined, "text"],
    ["main.ts", undefined, "code", "typescript"],
    ["config.yml", undefined, "code", "yaml"],
    ["data.json", undefined, "code", "json"],
    ["feed.xml", undefined, "code", "xml"],
    ["page.html", undefined, "html"],
    ["clip.webm", undefined, "video"],
    ["tone.wav", undefined, "audio"],
    ["bundle.zip", undefined, "archive"],
    ["part.stl", undefined, "model3d"],
    ["scene.glb", undefined, "model3d"],
    ["Dockerfile", undefined, "code", "dockerfile"],
    ["blob.bin", "application/octet-stream", "unknown"],
  ];
  for (const [name, mimeType, kind, language] of cases) {
    it(`reads ${name} as ${kind}`, () => {
      const detected = detectFileType({ name, mimeType });
      expect(detected.kind).toBe(kind);
      if (language) expect(detected.language).toBe(language);
    });
  }

  it("falls back to the MIME type without a known extension", () => {
    expect(
      detectFileType({ name: "upload", mimeType: "application/pdf" }).kind,
    ).toBe("pdf");
    expect(
      detectFileType({ name: "upload", mimeType: "image/svg+xml" }).kind,
    ).toBe("svg");
    expect(
      detectFileType({ name: "upload", mimeType: "text/plain; charset=utf-8" })
        .kind,
    ).toBe("text");
    expect(detectFileType({ name: "upload", mimeType: "video/mp4" }).kind).toBe(
      "video",
    );
  });

  it("lets the extension win over a generic or wrong type", () => {
    expect(
      detectFileType({ name: "a.png", mimeType: "application/octet-stream" })
        .kind,
    ).toBe("image");
    expect(
      detectFileType({ name: "a.html", mimeType: "text/plain" }).kind,
    ).toBe("html");
  });

  it("takes the extension from the last path segment only", () => {
    expect(fileExtension("folder.v2/archive")).toBe("");
    expect(fileExtension("dir\\name.TAR.GZ")).toBe("gz");
    expect(fileExtension(".env")).toBe("");
  });
});
