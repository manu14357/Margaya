import { isCloud } from "./is-cloud";

type RateLimitRule = { window: number; max: number };

/** On unless AUTH_RATE_LIMIT_ENABLED is "false" (read at startup). */
export function isAuthRateLimitEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== "false";
}

// Per client IP, in seconds. Generous enough for a person retrying a typo,
// tight enough to stop password and code guessing. The client IP comes from
// the transport (and TRUSTED_PROXIES); without one, Better Auth falls back to
// a single shared bucket per path.
const credentialRules: Record<string, RateLimitRule> = {
  "/sign-in/email": { window: 60, max: 10 },
  "/sign-in/email-otp": { window: 60, max: 10 },
  "/sign-in/magic-link": { window: 60, max: 5 },
  "/magic-link/verify": { window: 60, max: 10 },
  "/email-otp/send-verification-otp": { window: 60, max: 5 },
  "/email-otp/check-verification-otp": { window: 60, max: 10 },
  "/email-otp/verify-email": { window: 60, max: 10 },
  "/forget-password/email-otp": { window: 60, max: 3 },
  "/email-otp/request-password-reset": { window: 60, max: 3 },
  "/email-otp/reset-password": { window: 60, max: 5 },
  "/request-password-reset": { window: 60, max: 3 },
  "/reset-password": { window: 60, max: 5 },
  "/change-password": { window: 60, max: 5 },
};

// The stricter sign-up and invite limits answer abuse seen on the hosted
// service; self-hosted instances keep Better Auth's defaults for these.
const cloudOnlyRules: Record<string, RateLimitRule> = {
  "/sign-up/email": { window: 60, max: 3 },
  "/sign-in/anonymous": { window: 60, max: 3 },
  "/organization/invite-member": { window: 60, max: 5 },
};

/**
 * Better Auth's rate limit settings. Storage is Better Auth's in-memory store:
 * each API instance counts on its own, and a restart clears the counts.
 */
export function authRateLimitConfig() {
  return {
    enabled: isAuthRateLimitEnabled(process.env.AUTH_RATE_LIMIT_ENABLED),
    storage: "memory" as const,
    window: 10,
    max: 100,
    customRules: {
      // Every page load reads the session; it is not a guessing surface.
      "/get-session": false as const,
      // A page load checks ~40 workspace capabilities at once, and a 429
      // here hides actions the user is allowed to take. It only reads the
      // caller's own role, so there is nothing to guess.
      "/organization/has-permission": false as const,
      ...credentialRules,
      ...(isCloud() ? cloudOnlyRules : {}),
    },
  };
}
