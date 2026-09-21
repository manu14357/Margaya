export const DEFAULT_PUBLIC_SITE_URL = "https://margaya.app";

/**
 * The public website, which also serves the documentation at /docs.
 *
 * Docker images replace the "MARGAYA_PUBLIC_SITE_URL" placeholder at startup
 * (env.sh), and an unset variable becomes an empty string. Empty, unreplaced,
 * malformed or non-HTTP(S) values fall back to the hosted site. A path is kept
 * so the site can live under a prefix; the query, fragment and trailing
 * slashes are dropped so callers can append paths.
 */
export function resolvePublicSiteUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.startsWith("MARGAYA_")) {
    return DEFAULT_PUBLIC_SITE_URL;
  }
  try {
    const url = new URL(trimmed);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return DEFAULT_PUBLIC_SITE_URL;
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return DEFAULT_PUBLIC_SITE_URL;
  }
}

/** The documentation root on the given public site. */
export function getDocsUrl(siteUrl: string): string {
  return `${siteUrl}/docs`;
}
