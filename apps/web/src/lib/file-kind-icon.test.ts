import { File, FileArchive, FileText } from "lucide-react";
import { describe, expect, it } from "vitest";
import { fileKindIcon } from "./file-kind-icon";
import { formatBytes } from "./format-bytes";

describe("fileKindIcon", () => {
  it("shows a thumbnail for image attachments", () => {
    expect(fileKindIcon("image/png", "image")).toBe("image");
  });

  it("maps documents, archives and everything else", () => {
    expect(fileKindIcon("application/pdf")).toBe(FileText);
    expect(fileKindIcon("text/plain; charset=utf-8")).toBe(FileText);
    expect(fileKindIcon("application/zip")).toBe(FileArchive);
    expect(fileKindIcon("application/x-7z-compressed")).toBe(FileArchive);
    expect(fileKindIcon("application/gzip")).toBe(FileArchive);
    expect(fileKindIcon("application/octet-stream")).toBe(File);
    // An SVG is never shown inline, so it gets a plain file icon.
    expect(fileKindIcon("image/svg+xml", "attachment")).toBe(File);
  });
});

describe("formatBytes", () => {
  it("formats sizes and leaves unknown ones empty", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.00 MB");
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
  });
});
