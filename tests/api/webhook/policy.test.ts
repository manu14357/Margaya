import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ATTEMPT_ERRORS,
  classifyAttempt,
  MAX_RETRY_AFTER_MS,
  nextDelay,
  parseRetryAfter,
  RETRY_SCHEDULE_MS,
  shouldAutoDisable,
  signatureHeader,
  signBody,
} from "../../../apps/api/src/webhook/dispatch/policy";

const HOUR = 60 * 60 * 1000;

describe("classifyAttempt", () => {
  it.each([
    [200, "succeeded", null],
    [204, "succeeded", null],
    [301, "failed", ATTEMPT_ERRORS.redirect],
    [302, "failed", ATTEMPT_ERRORS.redirect],
    [400, "failed", null],
    [404, "failed", null],
    [408, "retry", null],
    [429, "retry", null],
    [500, "retry", null],
    [503, "retry", null],
  ] as const)("HTTP %i is %s", (status, result, error) => {
    expect(classifyAttempt({ kind: "response", status })).toEqual({
      result,
      error,
    });
  });

  it("retries timeouts, network errors and blocked destinations", () => {
    expect(classifyAttempt({ kind: "timeout" })).toEqual({
      result: "retry",
      error: "Timed out after 10 seconds",
    });
    expect(classifyAttempt({ kind: "network" })).toEqual({
      result: "retry",
      error: "Connection failed",
    });
    expect(classifyAttempt({ kind: "destination" })).toEqual({
      result: "retry",
      error: "Destination not allowed",
    });
  });

  it("fails at once when the secret can't be read", () => {
    expect(classifyAttempt({ kind: "secret" })).toEqual({
      result: "failed",
      error: "Signing secret unavailable",
    });
  });
});

describe("nextDelay", () => {
  it("follows the schedule within ±10%", () => {
    RETRY_SCHEDULE_MS.forEach((base, index) => {
      const attempt = index + 1;
      expect(nextDelay(attempt, null, () => 0)).toBe(Math.round(base * 0.9));
      expect(nextDelay(attempt, null, () => 1)).toBe(Math.round(base * 1.1));
    });
    expect(nextDelay(1, null, () => 0.5)).toBe(60_000);
  });

  it("honors a longer Retry-After, capped at 6 hours", () => {
    expect(nextDelay(1, 120, () => 0.5)).toBe(120_000);
    expect(nextDelay(1, 10, () => 0.5)).toBe(60_000);
    expect(nextDelay(1, 48 * 3600, () => 0.5)).toBe(MAX_RETRY_AFTER_MS);
  });
});

describe("parseRetryAfter", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");

  it("reads delta seconds and HTTP dates", () => {
    expect(parseRetryAfter("120", now)).toBe(120);
    expect(parseRetryAfter("Tue, 06 Oct 2026 12:05:00 GMT", now)).toBe(300);
    expect(parseRetryAfter("Tue, 06 Oct 2026 11:00:00 GMT", now)).toBe(0);
  });

  it("ignores missing or unreadable values", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter("soon", now)).toBeNull();
  });
});

describe("shouldAutoDisable", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("needs 5 failures in a row", () => {
    expect(shouldAutoDisable(4, ago(48 * HOUR), now)).toBe(false);
    expect(shouldAutoDisable(5, ago(48 * HOUR), now)).toBe(true);
  });

  it("needs the streak to be at least 24 hours old", () => {
    expect(shouldAutoDisable(5, ago(24 * HOUR - 60_000), now)).toBe(false);
    expect(shouldAutoDisable(5, ago(24 * HOUR), now)).toBe(true);
    expect(shouldAutoDisable(9, null, now)).toBe(false);
  });
});

describe("signing", () => {
  it("signs timestamp.body with HMAC-SHA256", () => {
    const expected = createHmac("sha256", "whsec_test")
      .update('1790000000.{"a":1}')
      .digest("hex");
    expect(signBody("whsec_test", "1790000000", '{"a":1}')).toBe(expected);
    // A fixed vector, so the scheme can't drift silently.
    expect(signBody("secret", "1", "{}")).toBe(
      createHmac("sha256", "secret").update("1.{}").digest("hex"),
    );
  });

  it("sends the current secret first, then the previous one", () => {
    const header = signatureHeader(["new", "old"], "10", "body");
    expect(header).toBe(
      `v1=${signBody("new", "10", "body")},v1=${signBody("old", "10", "body")}`,
    );
    expect(signatureHeader(["only"], "10", "body").split(",")).toHaveLength(1);
  });
});
