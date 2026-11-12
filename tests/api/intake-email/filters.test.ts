import { describe, expect, it } from "vitest";
import {
  isSpam,
  loopReason,
  normalizeDomainList,
  recipientTokens,
  senderDomainReason,
} from "../../../apps/api/src/intake-email/filters";

function headers(entries: Record<string, string>) {
  return new Map(
    Object.entries(entries).map(([name, value]) => [name, [value]]),
  );
}

describe("loopReason", () => {
  const own = ["requests@example.com"];

  it("lets ordinary mail through", () => {
    expect(loopReason(headers({}), "ana@x.org", "text/plain", own)).toBeNull();
    expect(
      loopReason(headers({ "auto-submitted": "no" }), "ana@x.org", "", own),
    ).toBeNull();
  });

  it("ignores auto-replies, bulk mail, bounces and our own mail", () => {
    expect(
      loopReason(
        headers({ "auto-submitted": "auto-replied" }),
        "a@x.org",
        "",
        own,
      ),
    ).toBe("auto_reply");
    expect(
      loopReason(headers({ "x-autoreply": "yes" }), "a@x.org", "", own),
    ).toBe("auto_reply");
    expect(
      loopReason(headers({ precedence: "bulk" }), "a@x.org", "", own),
    ).toBe("bulk");
    expect(loopReason(headers({}), "a@x.org", "multipart/report", own)).toBe(
      "bounce",
    );
    expect(
      loopReason(headers({ "return-path": "<>" }), "a@x.org", "", own),
    ).toBe("bounce");
    expect(loopReason(headers({}), "MAILER-DAEMON@x.org", "", own)).toBe(
      "bounce",
    );
    expect(loopReason(headers({}), "requests@example.com", "", own)).toBe(
      "loop",
    );
  });
});

describe("isSpam", () => {
  it("reads the spam headers and a provider score", () => {
    expect(isSpam(headers({}))).toBe(false);
    expect(isSpam(headers({ "x-spam-flag": "YES" }))).toBe(true);
    expect(isSpam(headers({ "x-spam-status": "Yes, score=9.1" }))).toBe(true);
    expect(isSpam(headers({ "x-spam-status": "No, score=0.1" }))).toBe(false);
    expect(isSpam(headers({ "x-spam-score": "6.2" }))).toBe(true);
    expect(isSpam(headers({}), 4.9)).toBe(false);
    expect(isSpam(headers({}), 5)).toBe(true);
  });
});

describe("sender domains", () => {
  it("cleans domain lists", () => {
    expect(
      normalizeDomainList([
        "@Example.org",
        "*.corp.example",
        "x.org.",
        "",
        "bad domain",
      ]),
    ).toEqual({
      domains: ["example.org", "corp.example", "x.org"],
      invalid: ["bad domain"],
    });
  });

  it("blocks first, then applies the allowlist with subdomains", () => {
    expect(senderDomainReason("a@spam.org", [], ["spam.org"])).toBe(
      "sender_blocked",
    );
    expect(
      senderDomainReason("a@mail.spam.org", ["spam.org"], ["spam.org"]),
    ).toBe("sender_blocked");
    expect(senderDomainReason("a@eu.acme.com", ["acme.com"], [])).toBeNull();
    expect(senderDomainReason("a@notacme.com", ["acme.com"], [])).toBe(
      "sender_not_allowed",
    );
    expect(senderDomainReason("a@any.org", [], [])).toBeNull();
  });
});

describe("recipientTokens", () => {
  const base = { local: "requests", domain: "example.com" };

  it("finds plus-address tokens of the base address", () => {
    expect(
      recipientTokens(
        [
          "Requests+ABCDEFGHIJKL1234@example.com",
          "requests+abcdefghijkl1234@example.com",
          "other+abcdefghijkl9999@example.com",
          "requests+short@example.com",
          "requests+abcdefghijkl5678@other.com",
        ],
        base,
      ),
    ).toEqual(["abcdefghijkl1234"]);
  });
});
