import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { isTrustedOrigin } from "./trusted-origins";

// Cross-site request forgery guard for cookie-authenticated writes.
//
// SameSite=Lax cookies already stop cross-site form posts on same-origin
// installs, but split-host HTTPS installs use SameSite=None (see
// get-default-cookie-attributes.ts), so a foreign page could submit a form
// that carries the session. Every state-changing request that carries a
// session cookie must therefore come from a trusted origin.
//
// - An Origin header must be trusted (MARGAYA_CLIENT_URL, MARGAYA_API_URL,
//   CORS_ORIGINS). "null" never is.
// - Without Origin, a Referer must be trusted.
// - Without either, a browser still announces itself through
//   Sec-Fetch-Site; anything but same-origin is refused. A client sending
//   none of the three is not a browser (a script with a copied cookie), so
//   it cannot be the victim of a forged request and is let through.
//
// Not checked here:
// - API-key and Bearer callers: they carry no ambient credential, and a
//   browser cannot add those headers cross-site without a CORS preflight.
// - OAuth callbacks (/api/auth/callback/*, /api/auth/oauth2/callback/*):
//   a provider may post them back cross-site; the OAuth state guards them.
//   The rest of /api/auth is checked here as well as by Better Auth's own
//   origin check, which some configurations (tests) switch off.
// - The SAML assertion endpoint (/api/auth/sso/saml2/sp/acs/*): the identity
//   provider's page posts it cross-site; it needs a signed response answering a
//   request this server made, and the session cookie plays no part.
// - MCP (/api/mcp*, /.well-known/*): bearer tokens; the consent decision
//   checks its own origin.
// - Signed webhooks (GitHub, Gitea, billing): no session cookie, and they
//   verify their own signatures.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-|__Host-)?[\w.-]*session_token=/;

const EXEMPT_PREFIXES = [
  "/api/auth/callback/",
  "/api/auth/oauth2/callback/",
  "/api/auth/sso/saml2/sp/acs/",
  "/api/mcp",
  "/api/.well-known/",
];

const SIGNED_WEBHOOKS = [
  /^\/api\/github-integration\/webhook\/?$/,
  /^\/api\/gitea-integration\/webhook\/[^/]+\/?$/,
  /^\/api\/billing\/webhook\/?$/,
];

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export type CsrfVerdict = { ok: true } | { ok: false; reason: string };

/** The decision for one request; exported for tests. */
export function checkCsrf(
  method: string,
  path: string,
  headers: Headers,
): CsrfVerdict {
  if (SAFE_METHODS.has(method.toUpperCase())) return { ok: true };
  if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return { ok: true };
  }
  if (SIGNED_WEBHOOKS.some((pattern) => pattern.test(path))) {
    return { ok: true };
  }
  if (headers.get("x-api-key")?.trim()) return { ok: true };
  if (/^Bearer\s+\S+$/i.test(headers.get("authorization") ?? "")) {
    return { ok: true };
  }
  if (!SESSION_COOKIE.test(headers.get("cookie") ?? "")) return { ok: true };

  const origin = headers.get("origin");
  if (origin !== null) {
    return origin !== "null" && isTrustedOrigin(origin)
      ? { ok: true }
      : { ok: false, reason: "untrusted origin" };
  }

  const referer = headers.get("referer");
  if (referer) {
    const refererOrigin = originOf(referer);
    return refererOrigin && isTrustedOrigin(refererOrigin)
      ? { ok: true }
      : { ok: false, reason: "untrusted referer" };
  }

  const fetchSite = headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") {
    return { ok: false, reason: "cross-site request without an origin" };
  }
  return { ok: true };
}

export function csrfGuard() {
  return async (c: Context, next: Next) => {
    const verdict = checkCsrf(c.req.method, c.req.path, c.req.raw.headers);
    if (!verdict.ok) {
      throw new HTTPException(403, {
        message:
          "Cross-site request refused. Use the web app, or authenticate with an API key.",
      });
    }
    return next();
  };
}
