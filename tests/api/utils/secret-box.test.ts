import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  canOpenSecret,
  openSecret,
  openWithKey,
  SECRET_BOX_PREFIX,
  SecretUnreadableError,
  sealSecret,
  sealWithKey,
} from "../../../apps/api/src/utils/secret-box";

const ORIGINAL = process.env.AUTH_SECRET;
const SECRET_A = "a".repeat(40);
const SECRET_B = "b".repeat(40);

afterEach(() => {
  process.env.AUTH_SECRET = ORIGINAL;
});

describe("secret box", () => {
  it("round-trips under the sbx:v1 prefix", () => {
    process.env.AUTH_SECRET = SECRET_A;
    const sealed = sealSecret("webhook-secret", "whsec_hello");
    expect(sealed.startsWith(SECRET_BOX_PREFIX)).toBe(true);
    expect(sealed).not.toContain("whsec_hello");
    expect(openSecret("webhook-secret", sealed)).toBe("whsec_hello");
    // A fresh IV every time.
    expect(sealSecret("webhook-secret", "whsec_hello")).not.toBe(sealed);
  });

  it("detects tampering", () => {
    process.env.AUTH_SECRET = SECRET_A;
    const sealed = sealSecret("webhook-secret", "whsec_hello");
    const [iv, tag, data] = sealed.slice(SECRET_BOX_PREFIX.length).split(".");
    const bytes = Buffer.from(data ?? "", "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    const flipped = `${SECRET_BOX_PREFIX}${iv}.${tag}.${bytes.toString("base64url")}`;
    expect(() => openSecret("webhook-secret", flipped)).toThrow(
      SecretUnreadableError,
    );
  });

  it("separates purposes", () => {
    process.env.AUTH_SECRET = SECRET_A;
    const sealed = sealSecret("webhook-secret", "x");
    expect(() => openSecret("other-purpose", sealed)).toThrow(
      SecretUnreadableError,
    );
  });

  it("can't open after AUTH_SECRET changes", () => {
    process.env.AUTH_SECRET = SECRET_A;
    const sealed = sealSecret("webhook-secret", "x");
    process.env.AUTH_SECRET = SECRET_B;
    expect(canOpenSecret("webhook-secret", sealed)).toBe(false);
    expect(() => openSecret("webhook-secret", sealed)).toThrow(
      SecretUnreadableError,
    );
    process.env.AUTH_SECRET = SECRET_A;
    expect(canOpenSecret("webhook-secret", sealed)).toBe(true);
  });

  it("rejects other prefixes and malformed values", () => {
    process.env.AUTH_SECRET = SECRET_A;
    for (const bad of [
      "",
      "plain",
      "enc:v1:a.b.c",
      `${SECRET_BOX_PREFIX}a.b`,
    ]) {
      expect(() => openSecret("webhook-secret", bad), bad).toThrow(
        SecretUnreadableError,
      );
    }
  });

  it("seals with an explicit key and prefix (notification secrets)", () => {
    const key = randomBytes(32);
    const sealed = sealWithKey(key, "enc:v1:", "token");
    expect(sealed.startsWith("enc:v1:")).toBe(true);
    expect(openWithKey(key, "enc:v1:", sealed)).toBe("token");
    expect(() => openWithKey(randomBytes(32), "enc:v1:", sealed)).toThrow(
      SecretUnreadableError,
    );
  });
});
