import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTurnstileSiteKey,
  resolveTurnstileSiteKey,
} from "./turnstile-site-key";

describe("resolveTurnstileSiteKey", () => {
  it("keeps a real site key", () => {
    expect(resolveTurnstileSiteKey(" 0x4AAAAAAAkey ")).toBe("0x4AAAAAAAkey");
  });

  it.each([undefined, "", "  ", "MARGAYA_TURNSTILE_SITE_KEY"])(
    "treats %j as CAPTCHA off",
    (value) => {
      expect(resolveTurnstileSiteKey(value)).toBeUndefined();
    },
  );
});

describe("getTurnstileSiteKey", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the value the container filled in at runtime", () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    expect(getTurnstileSiteKey()).toBeUndefined();
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "site-key");
    expect(getTurnstileSiteKey()).toBe("site-key");
  });
});
