import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLinkToken,
  LINK_TOKEN_TTL_SECONDS,
  readLinkToken,
} from "../../../apps/api/src/slack-app/link-token";
import {
  maskSealedSlackSecret,
  maskSlackSecret,
  openSlackSecret,
  sealSlackSecret,
} from "../../../apps/api/src/slack-app/secrets";
import {
  computeSlackSignature,
  verifySlackSignature,
} from "../../../apps/api/src/slack-app/signature";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "a".repeat(48));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifySlackSignature", () => {
  const secret = "8f742231b10e8888abcd99yyyzzz85a5";
  const body = "token=x&team_id=T1&command=%2Fmargaya&text=help";
  const now = 1_800_000_000;

  it("accepts a fresh, correctly signed request", () => {
    const timestamp = String(now - 10);
    const signature = computeSlackSignature(secret, timestamp, body);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp,
        signature,
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a replay older than five minutes, even with a valid signature", () => {
    const timestamp = String(now - 301);
    const signature = computeSlackSignature(secret, timestamp, body);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp,
        signature,
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("refuses a timestamp from the future", () => {
    const timestamp = String(now + 600);
    const signature = computeSlackSignature(secret, timestamp, body);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp,
        signature,
        rawBody: body,
        now,
      }).ok,
    ).toBe(false);
  });

  it("refuses a tampered body or a wrong secret", () => {
    const timestamp = String(now);
    const signature = computeSlackSignature(secret, timestamp, body);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp,
        signature,
        rawBody: `${body}&x=1`,
        now,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
    expect(
      verifySlackSignature({
        signingSecret: "another-secret-value-123456",
        timestamp,
        signature,
        rawBody: body,
        now,
      }).ok,
    ).toBe(false);
  });

  it("refuses missing headers", () => {
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: undefined,
        signature: "v0=abc",
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: false, reason: "missing" });
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: String(now),
        signature: null,
        rawBody: body,
        now,
      }),
    ).toEqual({ ok: false, reason: "missing" });
  });
});

describe("link tokens", () => {
  const claims = {
    workspaceId: "ws-1",
    teamId: "T1",
    slackUserId: "U1",
    slackUserName: "ana",
  };

  it("round-trips the Slack identity", () => {
    const token = createLinkToken(claims, 1000);
    expect(readLinkToken(token, 1001)).toEqual({
      ...claims,
      exp: 1000 + LINK_TOKEN_TTL_SECONDS,
    });
  });

  it("expires", () => {
    const token = createLinkToken(claims, 1000);
    expect(readLinkToken(token, 1001 + LINK_TOKEN_TTL_SECONDS)).toBeNull();
  });

  it("rejects a token whose claims were changed", () => {
    const token = createLinkToken(claims, 1000);
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ w: "ws-2", t: "T1", u: "U1", n: null, e: 999_999 }),
    ).toString("base64url");
    expect(readLinkToken(`${forged}.${signature}`, 1001)).toBeNull();
    expect(readLinkToken("garbage", 1001)).toBeNull();
  });

  it("stops working when AUTH_SECRET changes", () => {
    const token = createLinkToken(claims, 1000);
    vi.stubEnv("AUTH_SECRET", "b".repeat(48));
    expect(readLinkToken(token, 1001)).toBeNull();
  });
});

describe("Slack credentials", () => {
  it("are sealed, not stored as plain text", () => {
    const token = "xoxb-1234-5678-abcdefghijkl";
    const sealed = sealSlackSecret(token);
    expect(sealed).not.toContain(token);
    expect(sealed).not.toContain("abcdefghijkl");
    expect(openSlackSecret(sealed)).toBe(token);
  });

  it("are masked to a prefix and the last four characters", () => {
    expect(maskSlackSecret("xoxb-1234-5678-abcdefghijkl")).toBe("xoxb-…ijkl");
    expect(maskSlackSecret("xapp-1-A0-123-zz99")).toBe("xapp-…zz99");
    expect(maskSlackSecret("8f742231b10e8888abcd99yyyzzz85a5")).toBe("…85a5");
    expect(maskSlackSecret("short")).toBe("••••");
    expect(maskSlackSecret(null)).toBe("");
    expect(maskSealedSlackSecret(sealSlackSecret("xoxb-9-9-secretvalue"))).toBe(
      "xoxb-…alue",
    );
  });

  it("mask to nothing when the key changed", () => {
    const sealed = sealSlackSecret("xoxb-1234-5678-abcdefghijkl");
    vi.stubEnv("AUTH_SECRET", "c".repeat(48));
    expect(maskSealedSlackSecret(sealed)).toBe("");
  });
});
