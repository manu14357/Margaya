import { describe, expect, it } from "vitest";
import { normalizeEditorLinkUrl } from "./editor-link-url";

describe("normalizeEditorLinkUrl", () => {
  it("keeps web addresses and assumes https without a scheme", () => {
    expect(normalizeEditorLinkUrl(" https://example.com/a?b=1 ")).toEqual({
      ok: true,
      url: "https://example.com/a?b=1",
    });
    expect(normalizeEditorLinkUrl("example.com/docs")).toEqual({
      ok: true,
      url: "https://example.com/docs",
    });
    expect(normalizeEditorLinkUrl("http://localhost:3000")).toEqual({
      ok: true,
      url: "http://localhost:3000/",
    });
  });

  it("keeps mailto links with an address", () => {
    expect(normalizeEditorLinkUrl("mailto:team@example.com")).toEqual({
      ok: true,
      url: "mailto:team@example.com",
    });
    expect(normalizeEditorLinkUrl("mailto:nobody")).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("refuses scripts, other schemes, spaces and credentials", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://example.com",
      "not a link",
      "intranet",
    ]) {
      expect(normalizeEditorLinkUrl(value)).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    expect(normalizeEditorLinkUrl("https://user:pass@example.com")).toEqual({
      ok: false,
      error: "credentials",
    });
    expect(
      normalizeEditorLinkUrl(`https://example.com/${"a".repeat(2100)}`),
    ).toEqual({ ok: false, error: "tooLong" });
  });
});
