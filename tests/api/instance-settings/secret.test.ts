import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INSTANCE_SECRET_PREFIX,
  openInstanceSecret,
  sealInstanceSecret,
} from "../../../apps/api/src/instance-settings/secret";
import { openSecret } from "../../../apps/api/src/utils/secret-box";

const SECRET_A = "a".repeat(40);
const SECRET_B = "b".repeat(40);

afterEach(() => vi.unstubAllEnvs());

describe("instance setting secrets", () => {
  it("round-trips with a fresh IV each time", () => {
    vi.stubEnv("AUTH_SECRET", SECRET_A);
    const first = sealInstanceSecret("smtp-password");
    const second = sealInstanceSecret("smtp-password");
    expect(first).not.toBe(second);
    expect(first.startsWith(INSTANCE_SECRET_PREFIX)).toBe(true);
    expect(first).toMatch(/^sbx:v1:[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(first).not.toContain("smtp-password");
    expect(openInstanceSecret(first)).toBe("smtp-password");
  });

  it("fails on a tampered tag", () => {
    vi.stubEnv("AUTH_SECRET", SECRET_A);
    const sealed = sealInstanceSecret("value");
    const [iv, tag, data] = sealed
      .slice(INSTANCE_SECRET_PREFIX.length)
      .split(".");
    const flipped = `${tag?.[0] === "A" ? "B" : "A"}${tag?.slice(1)}`;
    expect(
      openInstanceSecret(`${INSTANCE_SECRET_PREFIX}${iv}.${flipped}.${data}`),
    ).toBeNull();
  });

  it("can't be read after AUTH_SECRET changes", () => {
    vi.stubEnv("AUTH_SECRET", SECRET_A);
    const sealed = sealInstanceSecret("value");
    vi.stubEnv("AUTH_SECRET", SECRET_B);
    expect(openInstanceSecret(sealed)).toBeNull();
  });

  it("uses its own key, not another purpose's", () => {
    vi.stubEnv("AUTH_SECRET", SECRET_A);
    const sealed = sealInstanceSecret("value");
    expect(() => openSecret("webhook-secret", sealed)).toThrow();
  });

  it("rejects malformed tokens", () => {
    vi.stubEnv("AUTH_SECRET", SECRET_A);
    expect(openInstanceSecret("plain")).toBeNull();
    expect(openInstanceSecret(`${INSTANCE_SECRET_PREFIX}a.b`)).toBeNull();
  });
});
