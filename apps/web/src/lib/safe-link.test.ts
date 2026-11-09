import { describe, expect, it } from "vitest";
import { resolveSafeLink } from "./safe-link";

const ORIGIN = "https://app.margaya.test";

describe("resolveSafeLink", () => {
  it("keeps a path in this app as an in-app link", () => {
    expect(
      resolveSafeLink(
        "/dashboard/workspace/ws/pages/p?panel=comments#c1",
        ORIGIN,
      ),
    ).toEqual({
      kind: "app",
      href: "/dashboard/workspace/ws/pages/p?panel=comments#c1",
    });
    expect(resolveSafeLink(`${ORIGIN}/dashboard/workspace/ws`, ORIGIN)).toEqual(
      { kind: "app", href: "/dashboard/workspace/ws" },
    );
  });

  it("opens http and https pages elsewhere as outside links", () => {
    expect(resolveSafeLink("https://example.com/a b", ORIGIN)).toEqual({
      kind: "web",
      href: "https://example.com/a%20b",
    });
    expect(resolveSafeLink("HTTP://example.com", ORIGIN)).toEqual({
      kind: "web",
      href: "http://example.com/",
    });
  });

  it("refuses every other scheme, credentials and relative tricks", () => {
    for (const href of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "mailto:someone@example.com",
      "https://user:secret@example.com/",
      "//evil.example/path",
      "/\\evil.example/path",
      "pages/relative",
      "#anchor",
      "",
      undefined,
    ]) {
      expect(resolveSafeLink(href, ORIGIN), String(href)).toBeNull();
    }
  });
});
