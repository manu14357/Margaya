import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUBLIC_SITE_URL,
  getDocsUrl,
  resolvePublicSiteUrl,
} from "./public-site-url";

describe("resolvePublicSiteUrl", () => {
  it.each([
    undefined,
    "",
    "   ",
    "MARGAYA_PUBLIC_SITE_URL",
    "not a url",
    "/docs",
    "ftp://example.com",
    "javascript:alert(1)",
    "https://user:secret@example.com",
  ])("falls back to the hosted site for %s", (value) => {
    expect(resolvePublicSiteUrl(value)).toBe(DEFAULT_PUBLIC_SITE_URL);
  });

  it.each([
    ["http://localhost:3001", "http://localhost:3001"],
    ["http://localhost:3001/", "http://localhost:3001"],
    [" https://www.example.com// ", "https://www.example.com"],
    ["https://example.com/margaya/", "https://example.com/margaya"],
    ["https://example.com/?ref=app#top", "https://example.com"],
    ["HTTPS://Example.COM", "https://example.com"],
  ])("normalizes %s", (value, expected) => {
    expect(resolvePublicSiteUrl(value)).toBe(expected);
  });
});

describe("getDocsUrl", () => {
  it("serves the docs under /docs on the public site", () => {
    expect(getDocsUrl(DEFAULT_PUBLIC_SITE_URL)).toBe(
      "https://margaya.app/docs",
    );
    expect(getDocsUrl(resolvePublicSiteUrl("http://localhost:3001/"))).toBe(
      "http://localhost:3001/docs",
    );
  });
});
