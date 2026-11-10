// Used by vite.config.ts at build time, so it must stay free of browser and
// alias imports.

export const DESKTOP_DISCOVERY_FILE = ".well-known/margaya-desktop.json";

/**
 * The document the desktop app reads when someone types this web address and
 * the API lives on another origin: `{ "apiUrl": "<API origin, no /api>" }`.
 *
 * Null when the build can't know the address. Docker images carry a
 * placeholder and write the file at container start instead (env.sh), and a
 * relative address means the API shares this origin, where `/api/config`
 * already answers.
 */
export function desktopDiscoveryDocument(
  viteApiUrl: string | undefined,
): string | null {
  // Same default as getApiUrl().
  const raw = viteApiUrl?.trim() || "http://localhost:1337";
  if (raw.startsWith("MARGAYA_")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    return null;
  }
  const apiUrl = `${url.origin}${url.pathname}`
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
  return `${JSON.stringify({ apiUrl })}\n`;
}
