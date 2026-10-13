import path from "node:path";
import { fileURLToPath } from "node:url";

// LOCAL DEVELOPMENT AND TESTING ONLY. None of these values may reach a
// production deployment.

export const E2E_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const REPO_ROOT = path.resolve(E2E_ROOT, "..", "..");
export const AUTH_DIR = path.join(E2E_ROOT, ".auth");
export const SEED_MANIFEST_PATH = path.join(AUTH_DIR, "seed.json");

export const E2E_API_PORT = 3337;
export const E2E_WEB_PORT = 5174;
export const E2E_API_URL = `http://localhost:${E2E_API_PORT}`;
export const E2E_WEB_URL = `http://localhost:${E2E_WEB_PORT}`;

export const E2E_DATABASE_NAME = "margaya_e2e";
export const E2E_DATABASE_URL = `postgresql://margaya:margaya@127.0.0.1:55432/${E2E_DATABASE_NAME}`;

export const MAILPIT_URL = "http://127.0.0.1:8025";
export const MAILPIT_SMTP_PORT = 1025;

export const DEV_API_URL = process.env.SEED_API_URL ?? "http://localhost:1337";
export const DEV_WEB_URL =
  process.env.SEED_CLIENT_URL ?? "http://localhost:5173";

/**
 * Environment for the API server the suite starts. Explicit values win over the
 * root .env because the API loads it without overriding existing variables.
 */
export const apiServerEnv: Record<string, string> = {
  NODE_ENV: "development",
  PORT: String(E2E_API_PORT),
  DATABASE_URL: E2E_DATABASE_URL,
  MARGAYA_API_URL: E2E_API_URL,
  MARGAYA_CLIENT_URL: E2E_WEB_URL,
  CORS_ORIGINS: E2E_WEB_URL,
  MARGAYA_INTERNAL_API_URL: `http://127.0.0.1:${E2E_API_PORT}`,
  AUTH_SECRET: "margaya-e2e-only-auth-secret-not-for-production-use-0001",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(MAILPIT_SMTP_PORT),
  SMTP_FROM: "noreply@margaya.test",
  // MailPit is a plain local relay: no TLS at all.
  SMTP_SECURE: "false",
  SMTP_REQUIRE_TLS: "false",
  // With SMTP configured the sign-in form defaults to email codes; the suite
  // signs in with passwords. Specs that need codes read them from MailPit.
  DISABLE_EMAIL_OTP_SIGN_IN: "true",
  // Every spec signs in from 127.0.0.1; the sign-in limits would trip.
  AUTH_RATE_LIMIT_ENABLED: "false",
  // Specs read notification emails from MailPit right away; batching would
  // hold them for the default five-minute window.
  EMAIL_NOTIFICATION_BATCH_WINDOW_SECONDS: "0",
  DISABLE_REGISTRATION: "false",
  DISABLE_PASSWORD_REGISTRATION: "false",
  DISABLE_WORKSPACE_CREATION: "false",
  MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS: "true",
  MARGAYA_CLOUD: "false",
  // Encrypts stored notification secrets (webhook signing secrets, ntfy and
  // Gotify tokens); without it, storing one answers 503.
  NOTIFICATION_SECRET_ENCRYPTION_KEY:
    "margaya-e2e-only-notification-secret-key-not-for-production-0001",
};

export const webServerEnv: Record<string, string> = {
  VITE_API_URL: E2E_API_URL,
  VITE_CLIENT_URL: E2E_WEB_URL,
};
