import { describe, expect, it } from "vitest";
import { createRedactor, passesLuhn } from "../../../apps/api/src/ai/redact";

describe("PII redaction", () => {
  it("replaces emails, phones, cards, IBANs and tokens, and restores them", () => {
    const redactor = createRedactor();
    const text = [
      "Mail ana@example.com or call +49 30 1234 5678.",
      "Card 4111 1111 1111 1111, IBAN DE89 3704 0044 0532 0130 00.",
      "Token sk-ant-abcdefghijklmnop and ghp_abcdefghijklmnopqrstuvwxyz0123.",
    ].join("\n");
    const redacted = redactor.redact(text);
    expect(redacted).not.toContain("ana@example.com");
    expect(redacted).not.toContain("1234 5678");
    expect(redacted).not.toContain("4111 1111");
    expect(redacted).not.toContain("DE89");
    expect(redacted).not.toContain("sk-ant-");
    expect(redacted).not.toContain("ghp_");
    expect(redacted).toContain("[EMAIL_1]");
    expect(redacted).toContain("[PHONE_1]");
    expect(redacted).toContain("[CARD_1]");
    expect(redacted).toContain("[IBAN_1]");
    expect(redacted).toContain("[SECRET_1]");
    expect(redacted).toContain("[SECRET_2]");
    expect(redactor.restore(redacted)).toBe(text);
    expect(redactor.count).toBe(6);
  });

  it("gives the same value the same placeholder", () => {
    const redactor = createRedactor();
    expect(redactor.redact("a@b.io, a@b.io and c@d.io")).toBe(
      "[EMAIL_1], [EMAIL_1] and [EMAIL_2]",
    );
  });

  it("leaves dates, task keys, short numbers and plain ids alone", () => {
    const redactor = createRedactor();
    const text =
      "WEB-12 is due 2026-10-21 at 14:30; estimate 13 points; id 1234567890123.";
    expect(redactor.redact(text)).toBe(text);
    expect(redactor.count).toBe(0);
  });

  it("only takes Luhn-valid numbers for cards", () => {
    expect(passesLuhn("4111 1111 1111 1111")).toBe(true);
    expect(passesLuhn("4111 1111 1111 1112")).toBe(false);
  });

  it("restores placeholders split across stream chunks", () => {
    const redactor = createRedactor();
    redactor.redact("ana@example.com");
    const stream = redactor.restoreStream();
    const out = [
      stream.push("Write to [EMA"),
      stream.push("IL_1] to"),
      stream.push("day [unrelated"),
      stream.flush(),
    ].join("");
    expect(out).toBe("Write to ana@example.com today [unrelated");
  });
});
