import { describe, expect, it } from "vitest";
import {
  displayHost,
  isGithubHost,
  normalizeLinkTitle,
  normalizeLinkUrl,
} from "./link-url";

function accepted(raw: string) {
  const result = normalizeLinkUrl(raw);
  if (!result.ok) throw new Error(`expected ${raw} to be accepted`);
  return result;
}

function refused(raw: string) {
  const result = normalizeLinkUrl(raw);
  if (result.ok) throw new Error(`expected ${raw} to be refused`);
  return result.error;
}

describe("normalizeLinkUrl", () => {
  it("assumes https without a scheme and returns the parser's form", () => {
    expect(accepted("example.com/spec")).toEqual({
      ok: true,
      url: "https://example.com/spec",
      host: "example.com",
    });
    expect(accepted("  https://Example.COM  ").url).toBe(
      "https://example.com/",
    );
    expect(accepted("http://example.com:80/a#section").url).toBe(
      "http://example.com/a#section",
    );
  });

  it("keeps host and port apart from a scheme", () => {
    expect(accepted("localhost:3000/board").url).toBe(
      "https://localhost:3000/board",
    );
    expect(accepted("example.com:8080").url).toBe("https://example.com:8080/");
  });

  it("accepts localhost and IP literals", () => {
    expect(accepted("http://localhost").host).toBe("localhost");
    expect(accepted("http://10.0.0.12:8080/wiki").host).toBe("10.0.0.12");
    expect(accepted("http://[::1]:3000/").host).toBe("[::1]");
  });

  it("requires a value", () => {
    expect(refused("")).toBe("required");
    expect(refused("   ")).toBe("required");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "mailto:someone@example.com",
    "https://exa mple.com",
    "https://example.com/\u0000",
    "https://intranet",
    "intranet",
    "https://",
  ])("refuses %s", (raw) => {
    expect(refused(raw)).toBe("invalid");
  });

  it("refuses user names and passwords", () => {
    for (const raw of [
      "https://user:secret@example.com",
      "https://user@example.com/",
      "user@example.com",
    ]) {
      expect(refused(raw)).toBe("credentials");
    }
  });

  it("allows 2,048 characters and refuses more", () => {
    const base = "https://example.com/";
    expect(accepted(base + "a".repeat(2048 - base.length)).url).toHaveLength(
      2048,
    );
    expect(refused(base + "a".repeat(2049 - base.length))).toBe("tooLong");
  });
});

describe("normalizeLinkTitle", () => {
  it("trims and turns empty into null", () => {
    expect(normalizeLinkTitle("  Spec  ")).toEqual({ ok: true, title: "Spec" });
    expect(normalizeLinkTitle("   ")).toEqual({ ok: true, title: null });
    expect(normalizeLinkTitle(null)).toEqual({ ok: true, title: null });
    expect(normalizeLinkTitle(undefined)).toEqual({ ok: true, title: null });
  });

  it("allows 255 characters and refuses more", () => {
    expect(normalizeLinkTitle("t".repeat(255))).toEqual({
      ok: true,
      title: "t".repeat(255),
    });
    expect(normalizeLinkTitle("t".repeat(256))).toEqual({
      ok: false,
      error: "titleTooLong",
    });
  });
});

describe("displayHost", () => {
  it("drops a single leading www.", () => {
    expect(displayHost("https://www.example.com/a")).toBe("example.com");
    expect(displayHost("https://www.www.example.com/")).toBe("www.example.com");
    expect(displayHost("https://docs.example.com/")).toBe("docs.example.com");
  });

  it("shows international names in punycode", () => {
    expect(accepted("https://bücher.example/").host).toBe(
      "xn--bcher-kva.example",
    );
  });

  it("returns an empty host for an unparseable value", () => {
    expect(displayHost("not a url")).toBe("");
  });
});

describe("isGithubHost", () => {
  it("matches github.com and its subdomains only", () => {
    expect(isGithubHost("github.com")).toBe(true);
    expect(isGithubHost("gist.github.com")).toBe(true);
    expect(isGithubHost("GitHub.com")).toBe(true);
    expect(isGithubHost("notgithub.com")).toBe(false);
    expect(isGithubHost("github.com.evil.example")).toBe(false);
  });
});
