import path from "node:path";
import { fileURLToPath } from "node:url";

// LOCAL DEVELOPMENT AND TESTING ONLY. None of these values may reach a
// production deployment.

export const E2E_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const REPO_ROOT = path.resolve(E2E_ROOT, "..", "..");
// E2E_AUTH_DIR, E2E_API_PORT and E2E_WEB_PORT run a second suite beside the
// default one (its own servers and seeded state) without touching it.
export const AUTH_DIR = process.env.E2E_AUTH_DIR
  ? path.resolve(process.env.E2E_AUTH_DIR)
  : path.join(E2E_ROOT, ".auth");
export const SEED_MANIFEST_PATH = path.join(AUTH_DIR, "seed.json");

export const E2E_API_PORT = Number(process.env.E2E_API_PORT) || 3337;
export const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT) || 5174;
export const E2E_API_URL = `http://localhost:${E2E_API_PORT}`;
export const E2E_WEB_URL = `http://localhost:${E2E_WEB_PORT}`;

/**
 * How the suite serves the web app. "preview" (the default) builds it once with
 * `vite build` and serves the bundle with `vite preview`: no cold compiles, no
 * dependency re-optimization and no HMR mid-run. E2E_WEB_SERVER=dev uses the
 * Vite dev server instead, which starts faster for a quick single-spec run
 * while you edit the app.
 */
export const E2E_WEB_MODE: "preview" | "dev" =
  process.env.E2E_WEB_SERVER === "dev" ? "dev" : "preview";
/** Where preview mode writes its bundle (gitignored). */
export const E2E_WEB_DIST = path.join(E2E_ROOT, ".web-dist");

export const E2E_DATABASE_NAME = "margaya_e2e";
// E2E_DATABASE_URL overrides it, e.g. when port 55432 is taken or reserved.
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgresql://margaya:margaya@127.0.0.1:55432/${E2E_DATABASE_NAME}`;

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
  // No S3 and no built-in local file store: specs cover the "uploads are not
  // configured" answers, and nothing is written under apps/api/data.
  MARGAYA_LOCAL_STORAGE: "false",
  // Encrypts stored notification secrets (webhook signing secrets, ntfy and
  // Gotify tokens); without it, storing one answers 503.
  NOTIFICATION_SECRET_ENCRYPTION_KEY:
    "margaya-e2e-only-notification-secret-key-not-for-production-0001",
  // Turns web push on so specs can reach its settings and routes.
  VAPID_PUBLIC_KEY:
    "BM4OfdRX1VZeE3BoIC-wV0uQLDh4D_B7UJa5Cj_GD-POE96aD5YKmvibWm8_ZyWXw_pkai80J8MUyNU0ZZBP21s",
  VAPID_PRIVATE_KEY: "GsqwQNeoD23t7hjX3hMKoXGK-rBalXQdATQEuJGNB6A",
};

/**
 * Environment for the web server. The VITE_ values are read at build time in
 * preview mode and per request in dev mode.
 */
export const webServerEnv: Record<string, string> = {
  VITE_API_URL: E2E_API_URL,
  VITE_CLIENT_URL: E2E_WEB_URL,
  // Dev mode only: other work in the same tree must not hot-reload pages
  // mid-test; each navigation still serves the current source.
  MARGAYA_DISABLE_HMR: "true",
};

/** The command that serves the web app on E2E_WEB_PORT, per E2E_WEB_MODE. */
export function webServerCommand(): string {
  const port = `--port ${E2E_WEB_PORT} --strictPort`;
  if (E2E_WEB_MODE === "dev") return `pnpm exec vite ${port}`;
  const outDir = `--outDir "${E2E_WEB_DIST}"`;
  // Development mode reads the same env files as the dev server. The default
  // production mode would load apps/web/.env.production: its CAPTCHA site key
  // locks the sign-up form, and its Sentry DSN would report test errors.
  // Vite still emits a production bundle.
  return `pnpm exec vite build --mode development ${outDir} --emptyOutDir --logLevel warn && pnpm exec vite preview --mode development ${outDir} ${port}`;
}
