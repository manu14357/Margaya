import { appVersion } from "./app-version";

// Margaya Desktop (apps/desktop) loads this server's own web UI and signs in
// through the system browser (utils/desktop-sign-in.ts). These are the values
// it discovers through GET /api/config.

const DEFAULT_MIN_DESKTOP_VERSION = "0.1.0";
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** On unless DESKTOP_SIGN_IN_ENABLED is "false". Read per request. */
export function desktopSignInEnabled() {
  return process.env.DESKTOP_SIGN_IN_ENABLED?.trim().toLowerCase() !== "false";
}

/** The web app's public origin and path, without a trailing slash. */
export function publicWebUrl() {
  return (process.env.MARGAYA_CLIENT_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
}

/** The API's public origin; Better Auth and every route live under /api there. */
export function publicApiUrl() {
  const configured = process.env.MARGAYA_API_URL || "http://localhost:1337";
  try {
    return new URL(configured).origin;
  } catch {
    return configured.replace(/\/+$/, "");
  }
}

export function desktopConfig() {
  const minimum = process.env.DESKTOP_MIN_VERSION?.trim();
  return {
    enabled: desktopSignInEnabled(),
    serverVersion: process.env.MARGAYA_VERSION?.trim() || appVersion(),
    minDesktopVersion:
      minimum && VERSION.test(minimum) ? minimum : DEFAULT_MIN_DESKTOP_VERSION,
    webUrl: publicWebUrl(),
    apiUrl: publicApiUrl(),
  };
}
