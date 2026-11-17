import type { Context, Next } from "hono";

// Response headers for the API. The web app sets its own page policy in
// nginx; these cover split-host installs, where browsers reach the API
// directly. The API serves JSON, redirects and uploaded files, never pages,
// so its content policy forbids everything, framing included. Better Auth's
// interactive API reference is the one HTML page and keeps its scripts. The
// SAML assertion endpoint's re-post page (identity/saml-request.ts) brings a
// policy of its own, which is kept, and so does an inline PDF from
// GET /api/asset/{id} (utils/asset-response.ts), which the web app's file
// preview may frame.

const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const keepsOwnPolicy = (c: Context) =>
  c.req.path.startsWith("/api/auth/reference") ||
  ((c.req.path.startsWith("/api/auth/sso/saml2/sp/acs/") ||
    c.req.path.startsWith("/api/asset/")) &&
    c.res.headers.has("Content-Security-Policy"));

// Only a response that brings its own frame-ancestors also brings its own
// X-Frame-Options; everything else may never be framed.
const keepsOwnFrameOptions = (c: Context) =>
  c.req.path.startsWith("/api/asset/") &&
  c.res.headers.has("Content-Security-Policy") &&
  c.res.headers.has("X-Frame-Options");

const HSTS = "max-age=15552000";

function servedOverHttps(c: Context): boolean {
  // The configured public URL decides: TLS usually ends at a proxy, and a
  // browser ignores HSTS received over plain HTTP anyway.
  const configured = process.env.MARGAYA_API_URL?.trim();
  if (configured) return configured.toLowerCase().startsWith("https://");
  return new URL(c.req.url).protocol === "https:";
}

export function securityHeaders() {
  return async (c: Context, next: Next) => {
    await next();
    try {
      const headers = c.res.headers;
      const ownFrameOptions = keepsOwnFrameOptions(c);
      if (!keepsOwnPolicy(c)) {
        headers.set("Content-Security-Policy", API_CONTENT_SECURITY_POLICY);
      }
      headers.set("X-Content-Type-Options", "nosniff");
      if (!ownFrameOptions) headers.set("X-Frame-Options", "DENY");
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      if (servedOverHttps(c)) {
        headers.set("Strict-Transport-Security", HSTS);
      }
    } catch {
      // A passed-through response with immutable headers keeps its own.
    }
  };
}
