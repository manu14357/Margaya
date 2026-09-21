import { describe, expect, it } from "vitest";
import { fileNameFromDisposition } from "./file-name";

describe("fileNameFromDisposition", () => {
  it("prefers the UTF-8 filename* form", () => {
    expect(
      fileNameFromDisposition(
        `attachment; filename="caf_-tasks.csv"; filename*=UTF-8''caf%C3%A9-tasks.csv`,
        "fallback.csv",
      ),
    ).toBe("café-tasks.csv");
  });

  it("reads a quoted or bare filename", () => {
    expect(
      fileNameFromDisposition(
        'attachment; filename="acme-tasks-2026-10-06.xlsx"',
        "x",
      ),
    ).toBe("acme-tasks-2026-10-06.xlsx");
    expect(
      fileNameFromDisposition("attachment; filename=tasks.json", "x"),
    ).toBe("tasks.json");
  });

  it("falls back on a malformed escape to the plain name", () => {
    expect(
      fileNameFromDisposition(
        `attachment; filename="plain.csv"; filename*=UTF-8''bad%E0%A4`,
        "x",
      ),
    ).toBe("plain.csv");
  });

  it("uses the fallback when the header is missing or has no name", () => {
    expect(fileNameFromDisposition(null, "row-name.zip")).toBe("row-name.zip");
    expect(fileNameFromDisposition("attachment", "row-name.zip")).toBe(
      "row-name.zip",
    );
  });
});
