import { createRateLimiter } from "../utils/rate-limit";

// B12 §3.10: per-admin limits on the instance-admin writes.

export const testEmailLimiter = createRateLimiter({
  name: "admin-test-email",
  windowSeconds: 60,
  max: 5,
});

// Password confirmations for the re-authentication window.
export const reauthLimiter = createRateLimiter({
  name: "admin-reauth",
  windowSeconds: 60,
  max: 5,
});

export const settingsWriteLimiter = createRateLimiter({
  name: "admin-settings-write",
  windowSeconds: 60,
  max: 30,
});

// The health page connects to SMTP and storage on every load.
export const healthLimiter = createRateLimiter({
  name: "admin-health",
  windowSeconds: 60,
  max: 20,
});
