import { createECDH, createPublicKey, type ECDH, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPushRequest,
  encryptPushPayload,
  generateVapidKeys,
  getVapidConfig,
  isP256PublicKey,
  isPushAuthSecret,
  pushKeysEnvLines,
  warnAboutPushSubject,
} from "../../../apps/api/src/notification-preferences/web-push";

// The worked example in RFC 8291, Appendix A.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

function senderFromRfc(): ECDH {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(RFC.asPrivate, "base64url"));
  return ecdh;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("web push encryption", () => {
  it("matches the RFC 8291 test vector byte for byte", () => {
    const body = encryptPushPayload(
      RFC.plaintext,
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { salt: Buffer.from(RFC.salt, "base64url"), ecdh: senderFromRfc() },
    );
    expect(body.toString("base64url")).toBe(RFC.message);
  });

  it("uses a fresh salt and key for every message", () => {
    const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };
    expect(
      encryptPushPayload("same", keys).equals(encryptPushPayload("same", keys)),
    ).toBe(false);
  });
});

describe("VAPID", () => {
  const pair = generateVapidKeys();

  function stubKeys(publicKey: string, privateKey: string) {
    vi.stubEnv("VAPID_PUBLIC_KEY", publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", privateKey);
  }

  it("is off until both keys are set", () => {
    stubKeys("", "");
    expect(getVapidConfig()).toBeNull();
    stubKeys(pair.publicKey, "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getVapidConfig()).toBeNull();
  });

  it("stays off, without throwing, when the keys are not a pair", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubKeys(pair.publicKey, generateVapidKeys().privateKey);
    expect(getVapidConfig()).toBeNull();
    stubKeys("not-a-key", "also-not-a-key");
    expect(getVapidConfig()).toBeNull();
  });

  it("names a contact: the set subject, else an https client URL", () => {
    stubKeys(pair.publicKey, pair.privateKey);
    vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.com");
    expect(getVapidConfig()?.subject).toBe("mailto:ops@example.com");

    vi.stubEnv("VAPID_SUBJECT", "");
    vi.stubEnv("MARGAYA_CLIENT_URL", "https://margaya.example.com/");
    expect(getVapidConfig()?.subject).toBe("https://margaya.example.com");

    vi.stubEnv("MARGAYA_CLIENT_URL", "http://localhost:5173");
    expect(getVapidConfig()?.subject).toMatch(/^mailto:/);
  });

  describe("a contact push services may refuse", () => {
    function startupWarnings() {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnAboutPushSubject();
      const calls = warn.mock.calls.map((args) => String(args[0]));
      warn.mockRestore();
      return calls;
    }

    it("warns at startup while push falls back to the example address", () => {
      stubKeys(pair.publicKey, pair.privateKey);
      vi.stubEnv("VAPID_SUBJECT", "");
      vi.stubEnv("MARGAYA_CLIENT_URL", "http://192.168.1.20:5173");
      const [warning, ...rest] = startupWarnings();
      expect(rest).toEqual([]);
      expect(warning).toContain("mailto:admin@example.com");
      expect(warning).toContain("VAPID_SUBJECT");
    });

    it("warns when the example address, or any reserved one, is set", () => {
      stubKeys(pair.publicKey, pair.privateKey);
      vi.stubEnv("MARGAYA_CLIENT_URL", "https://margaya.acme.dev");
      for (const subject of [
        "mailto:admin@example.com",
        "mailto:ops@push.example.org",
        "mailto:me@margaya.test",
        "https://localhost:5173",
      ]) {
        vi.stubEnv("VAPID_SUBJECT", subject);
        expect(startupWarnings(), subject).toHaveLength(1);
      }
    });

    it("warns about a subject that isn't mailto: or https:, without echoing it", () => {
      stubKeys(pair.publicKey, pair.privateKey);
      for (const subject of [
        "ops@acme.dev",
        "http://margaya.acme.dev",
        "mailto:nobody",
      ]) {
        vi.stubEnv("VAPID_SUBJECT", subject);
        const warnings = startupWarnings();
        expect(warnings, subject).toHaveLength(1);
        expect(warnings[0]).toContain("mailto:");
        expect(warnings[0]).not.toContain(subject);
      }
    });

    it("stays quiet for a real contact, or with push off", () => {
      stubKeys(pair.publicKey, pair.privateKey);
      vi.stubEnv("VAPID_SUBJECT", "");
      vi.stubEnv("MARGAYA_CLIENT_URL", "https://margaya.acme.dev");
      expect(startupWarnings()).toEqual([]);
      vi.stubEnv("VAPID_SUBJECT", "mailto:ops@acme.dev");
      expect(startupWarnings()).toEqual([]);

      stubKeys("", "");
      vi.stubEnv("VAPID_SUBJECT", "mailto:admin@example.com");
      expect(startupWarnings()).toEqual([]);
    });
  });

  describe("generate-push-keys output", () => {
    const keys = { publicKey: "PUBLIC", privateKey: "PRIVATE" };
    const assignments = (lines: string[]) =>
      lines.filter((line) => !line.startsWith("#"));

    it("prints both keys, and only comments besides, so it pastes into .env", () => {
      vi.stubEnv("VAPID_SUBJECT", "");
      vi.stubEnv("MARGAYA_CLIENT_URL", "https://margaya.acme.dev/");
      const lines = pushKeysEnvLines(keys);
      expect(assignments(lines)).toEqual([
        "VAPID_PUBLIC_KEY=PUBLIC",
        "VAPID_PRIVATE_KEY=PRIVATE",
      ]);
      expect(lines.join("\n")).toContain("https://margaya.acme.dev");
    });

    it("says to set VAPID_SUBJECT when the contact would be the example address", () => {
      vi.stubEnv("VAPID_SUBJECT", "");
      vi.stubEnv("MARGAYA_CLIENT_URL", "http://localhost:5173");
      const lines = pushKeysEnvLines(keys);
      expect(assignments(lines)).toHaveLength(2);
      const comments = lines.slice(2).join("\n");
      expect(comments).toContain("VAPID_SUBJECT");
      expect(comments).toContain("mailto:admin@example.com");
    });
  });

  it("signs a token for the push service's origin that its public key verifies", () => {
    stubKeys(pair.publicKey, pair.privateKey);
    vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.com");
    const vapid = getVapidConfig();
    if (!vapid) throw new Error("expected a push identity");

    const { headers } = buildPushRequest({
      endpoint: "https://push.example.com/send/abc?x=1",
      keys: { p256dh: RFC.uaPublic, auth: RFC.auth },
      payload: "{}",
      urgency: "high",
      vapid,
    });

    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Urgency).toBe("high");
    expect(Number(headers.TTL)).toBeGreaterThan(0);

    const match = headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
    if (!match) throw new Error(headers.Authorization);
    const [, token, key] = match;
    expect(key).toBe(pair.publicKey);

    const [header, claims, signature] = (token as string).split(".");
    const decoded = JSON.parse(
      Buffer.from(claims as string, "base64url").toString(),
    );
    expect(decoded.aud).toBe("https://push.example.com");
    expect(decoded.sub).toBe("mailto:ops@example.com");
    // RFC 8292 allows at most 24 hours.
    expect(decoded.exp).toBeLessThanOrEqual(Date.now() / 1000 + 24 * 60 * 60);

    const publicKey = Buffer.from(pair.publicKey, "base64url");
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        {
          key: createPublicKey({
            format: "jwk",
            key: {
              kty: "EC",
              crv: "P-256",
              x: publicKey.subarray(1, 33).toString("base64url"),
              y: publicKey.subarray(33).toString("base64url"),
            },
          }),
          dsaEncoding: "ieee-p1363",
        },
        Buffer.from(signature as string, "base64url"),
      ),
    ).toBe(true);
  });
});

describe("subscription key checks", () => {
  it("accepts a real device key and refuses anything else", () => {
    expect(isP256PublicKey(RFC.uaPublic)).toBe(true);
    expect(isP256PublicKey("")).toBe(false);
    expect(isP256PublicKey("short")).toBe(false);
    // Right length and prefix, but not a point on the curve.
    expect(
      isP256PublicKey(
        Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString(
          "base64url",
        ),
      ),
    ).toBe(false);
  });

  it("wants a 16-byte auth secret", () => {
    expect(isPushAuthSecret(RFC.auth)).toBe(true);
    expect(isPushAuthSecret("short")).toBe(false);
  });
});
