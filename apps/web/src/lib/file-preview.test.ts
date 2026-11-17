import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectEditorFiles,
  fileDownloadUrl,
  isServerFileUrl,
  previewKind,
  resolveFileUrl,
} from "./file-preview";

// The test environment's API is VITE_API_URL's default, http://localhost:1337.
const API = "http://localhost:1337";
const asset = `${API}/api/asset/abc123`;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("resolveFileUrl", () => {
  it("keeps absolute http(s) links", () => {
    expect(resolveFileUrl(asset)).toBe(asset);
    expect(resolveFileUrl("https://files.example.com/a.pdf")).toBe(
      "https://files.example.com/a.pdf",
    );
  });

  it("sends this server's relative /api paths to the API", () => {
    expect(resolveFileUrl("/api/asset/abc123")).toBe(asset);
  });

  it("resolves other relative paths against this page", () => {
    expect(resolveFileUrl("/files/a.pdf")).toBe(
      `${window.location.origin}/files/a.pdf`,
    );
  });

  it("refuses scripts, data, other schemes and tricks", () => {
    for (const raw of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "file:///C:/Windows/win.ini",
      "//evil.example/a.pdf",
      "/\\evil.example/a.pdf",
      "https://user:pass@example.com/a.pdf",
      "a.pdf",
      "",
      null,
      undefined,
    ]) {
      expect(resolveFileUrl(raw), String(raw)).toBeNull();
    }
  });
});

describe("previewKind", () => {
  const file = (name: string, mimeType?: string, url = asset) => ({
    url,
    name,
    mimeType,
  });

  it("previews images, PDFs, text, audio and video of this server", () => {
    expect(previewKind(file("a.png", "image/png"))).toBe("image");
    expect(previewKind(file("a.pdf", "application/pdf"))).toBe("pdf");
    expect(previewKind(file("a.txt", "text/plain"))).toBe("text");
    expect(previewKind(file("a.csv", "text/csv"))).toBe("text");
    expect(previewKind(file("a.json", "application/json"))).toBe("text");
    expect(previewKind(file("a.ts", "application/octet-stream"))).toBe("text");
    expect(previewKind(file("a.wav", "audio/wav"))).toBe("audio");
    expect(previewKind(file("a.mp4", "video/mp4"))).toBe("video");
  });

  it("falls back to the file name when the type was lost", () => {
    expect(previewKind(file("AI_Engineering.pdf"))).toBe("pdf");
    expect(previewKind(file("photo.JPG"))).toBe("image");
    expect(previewKind(file("notes.md"))).toBe("text");
  });

  it("never renders HTML or SVG, and offers archives as downloads", () => {
    expect(previewKind(file("x.svg", "image/svg+xml"))).toBe("none");
    expect(previewKind(file("x.html", "text/html"))).toBe("none");
    expect(previewKind(file("x.zip", "application/zip"))).toBe("none");
    expect(previewKind(file("x.bin"))).toBe("none");
  });

  it("frames and fetches only this server's files", () => {
    const outside = "https://elsewhere.example/a";
    expect(previewKind(file("a.pdf", "application/pdf", outside))).toBe("none");
    expect(previewKind(file("a.txt", "text/plain", outside))).toBe("none");
    // An image elsewhere is just an <img>.
    expect(previewKind(file("a.png", "image/png", outside))).toBe("image");
    expect(previewKind({ url: outside, name: "x", kind: "image" })).toBe(
      "image",
    );
  });
});

describe("server and download URLs", () => {
  it("knows this page's and the API's origins", () => {
    expect(isServerFileUrl(asset)).toBe(true);
    expect(isServerFileUrl(`${window.location.origin}/x`)).toBe(true);
    expect(isServerFileUrl("https://elsewhere.example/x")).toBe(false);
  });

  it("asks this server's assets for a download", () => {
    expect(fileDownloadUrl(asset)).toBe(`${asset}?download=1`);
    expect(fileDownloadUrl("https://elsewhere.example/a.pdf")).toBe(
      "https://elsewhere.example/a.pdf",
    );
  });
});

describe("collectEditorFiles", () => {
  it("lists images and file cards in document order with the current one", () => {
    document.body.innerHTML = `
      <div class="ProseMirror">
        <a data-file-preview-url="${asset}" data-file-preview-name="a.pdf" data-file-preview-type="application/pdf" data-file-preview-size="10">a</a>
        <img class="margaya-editor-image" src="${API}/api/asset/img1" alt="Diagram">
        <img class="other" src="${API}/api/asset/ignored">
        <a data-file-preview-url="javascript:alert(1)" data-file-preview-name="bad">bad</a>
        <a id="current" data-file-preview-url="/api/asset/t1" data-file-preview-name="notes.txt">t</a>
      </div>`;
    const root = document.querySelector(".ProseMirror") as Element;
    const { files, index } = collectEditorFiles(
      root,
      document.getElementById("current"),
    );
    expect(files).toEqual([
      { url: asset, name: "a.pdf", mimeType: "application/pdf", size: 10 },
      { url: `${API}/api/asset/img1`, name: "Diagram", kind: "image" },
      {
        url: `${API}/api/asset/t1`,
        name: "notes.txt",
        mimeType: undefined,
        size: undefined,
      },
    ]);
    expect(index).toBe(2);
  });
});
