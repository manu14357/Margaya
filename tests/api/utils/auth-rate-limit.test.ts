import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authRateLimitConfig,
  isAuthRateLimitEnabled,
} from "../../../apps/api/src/utils/auth-rate-limit";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth rate limit settings", () => {
  it("is on unless explicitly turned off", () => {
    expect(isAuthRateLimitEnabled(undefined)).toBe(true);
    expect(isAuthRateLimitEnabled("")).toBe(true);
    expect(isAuthRateLimitEnabled("true")).toBe(true);
    expect(isAuthRateLimitEnabled("FALSE")).toBe(false);
    expect(isAuthRateLimitEnabled(" false ")).toBe(false);
  });

  it("limits credential paths everywhere and sign-up only on cloud", () => {
    vi.stubEnv("MARGAYA_CLOUD", "false");
    const selfHosted = authRateLimitConfig();
    expect(selfHosted.storage).toBe("memory");
    expect(selfHosted.customRules["/sign-in/email"]).toEqual({
      window: 60,
      max: 10,
    });
    expect(selfHosted.customRules["/request-password-reset"]).toBeDefined();
    expect(selfHosted.customRules["/change-password"]).toBeDefined();
    expect(selfHosted.customRules["/get-session"]).toBe(false);
    expect(selfHosted.customRules).not.toHaveProperty("/sign-up/email");

    vi.stubEnv("MARGAYA_CLOUD", "true");
    expect(authRateLimitConfig().customRules["/sign-up/email"]).toEqual({
      window: 60,
      max: 3,
    });
  });
});
