import { describe, expect, it } from "vitest";
import {
  dropInlineHandlers,
  sanitizeHtmlDocument,
  sanitizeMarkdownHtml,
  sanitizeSvg,
} from "./sanitize";

describe("sanitize", () => {
  it("drops handler attributes from tags but leaves text alone", () => {
    expect(
      dropInlineHandlers(
        `<h1 class="a" onclick="x()" ONLOAD='y()' onerror=z>set onclick="x" here</h1>`,
      ),
    ).toBe(`<h1 class="a">set onclick="x" here</h1>`);
  });

  it("makes an uploaded page inert and self-contained", () => {
    const out = sanitizeHtmlDocument(
      `<html><head><link rel="stylesheet" href="https://x.test/a.css"></head><body><h1 onclick="a()">Hi</h1><script>b()</script><img src="https://x.test/p.gif"><img src="data:image/png;base64,AA"><a href="https://x.test">x</a><form action="https://x.test"><input></form></body></html>`,
    );
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("Content-Security-Policy");
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(
      out.indexOf("<h1"),
    );
    for (const banned of [
      "<script",
      "onclick",
      "x.test/p.gif",
      "<link",
      "<form",
      'href="https',
    ]) {
      expect(out).not.toContain(banned);
    }
    expect(out).toContain('src="data:image/png;base64,AA"');
  });

  it("keeps safe markdown links and drops script ones", () => {
    const out = sanitizeMarkdownHtml(
      `<p><a href="https://x.test">ok</a> <a href="javascript:alert(1)">bad</a> <img src="http://x.test/a.png"></p>`,
    );
    expect(out).toContain('target="_blank"');
    expect(out).toContain("noopener");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("http://x.test/a.png");
  });

  it("strips scripts and handlers from SVG", () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="a()"><script>b()</script><a href="javascript:c()"><rect width="1" height="1"/></a></svg>`,
    );
    expect(out).toContain("<rect");
    expect(out).not.toMatch(/script|onload|javascript:/);
  });
});
