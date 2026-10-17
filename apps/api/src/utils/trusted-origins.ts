// The browser origins this instance trusts with cookie-authenticated
// requests: the web app (MARGAYA_CLIENT_URL), the API itself
// (MARGAYA_API_URL) and every CORS_ORIGINS entry. Development without
// configured URLs falls back to the local defaults. Read per call so tests
// and a changed environment never see a stale list.

function configuredOriginValues(): (string | undefined)[] {
  const values = [
    process.env.MARGAYA_CLIENT_URL,
    process.env.MARGAYA_API_URL,
    ...(process.env.CORS_ORIGINS ?? "").split(","),
  ];
  if (process.env.NODE_ENV !== "production") {
    if (!process.env.MARGAYA_CLIENT_URL) values.push("http://localhost:5173");
    if (!process.env.MARGAYA_API_URL) values.push("http://localhost:1337");
  }
  return values;
}

/** Whether `origin` (an Origin header value) is one this instance trusts. */
export function isTrustedOrigin(origin: string): boolean {
  for (const value of configuredOriginValues()) {
    if (!value?.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password &&
        url.origin === origin
      ) {
        return true;
      }
    } catch {
      // Invalid entries and wildcards do not grant access.
    }
  }
  return false;
}
