import { createHash, randomBytes } from "node:crypto";
import {
  type BetterAuthPlugin,
  type GenericEndpointContext,
  HIDE_METADATA,
} from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { expireCookie, setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

// With the app and API on different sites, the session cookie is Partitioned
// (get-default-cookie-attributes.ts), so the browser files it under the site of
// the page on top when it's set. Sign-in through a provider ends with the browser
// on the API itself (the SAML assertion endpoint or an OAuth callback), so a
// cookie set there lands under the API's own site and the app never sees it.
//
// So when sign-in starts from the app on another site, the API marks the browser
// with a cookie of its own, unpartitioned (like the SAML binding cookie) so it
// also reaches the API on that last step. When sign-in succeeds with it present,
// the API holds the session cookie back, stores a one-time token for the session,
// and sends the browser to the app's /auth/complete with the token in the
// fragment, which no server log or Referer ever sees. The app redeems it with a
// fetch, so the session cookie set in answer lands under the app's site. The
// token is stored hashed, lasts a minute, is used up on the first try, and only
// redeems in the browser holding the matching cookie: nobody can sign someone
// in to their own account by sending them a token.
//
// Same-origin and same-site installs never take this path: a browser calls the
// start request "cross-site" only when the app and API are on different sites.

const TOKEN_PREFIX = "auth-handoff:";
const TOKEN_LIFETIME_MS = 60_000;
// As long as Better Auth keeps an OAuth sign-in going.
const BROWSER_COOKIE_MAX_AGE = 600;
// Better Auth's own lifetime for the OAuth state cookie.
const STATE_COOKIE_MAX_AGE = 300;
export const HANDOFF_APP_PATH = "/auth/complete";

const SIGN_IN_STARTS = new Set([
  "/sign-in/sso",
  "/sign-in/social",
  "/sign-in/oauth2",
]);

/** Where a sign-in that goes through a provider ends: on the API, in the browser. */
const endsOnTheApi = (path: string) =>
  path.startsWith("/sso/saml2/sp/acs/") ||
  path.startsWith("/callback/") ||
  path.startsWith("/oauth2/callback/");

const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

type Context = Pick<GenericEndpointContext, "context">;

function browserCookie(ctx: Context) {
  return ctx.context.createAuthCookie("handoff", {
    sameSite: "none",
    secure: true,
    httpOnly: true,
    partitioned: false,
    path: new URL(ctx.context.baseURL).pathname,
    maxAge: BROWSER_COOKIE_MAX_AGE,
  });
}

function stateIn(url: string) {
  try {
    return new URL(url).searchParams.get("state");
  } catch {
    return null;
  }
}

/**
 * After a sign-in start: on an install whose app and API are on different sites,
 * marks this browser so the sign-in's last step can hand the session over.
 */
export async function markCrossSiteSignIn(
  ctx: Context &
    Pick<
      GenericEndpointContext,
      "path" | "headers" | "setCookie" | "setSignedCookie"
    >,
  crossSiteInstall: boolean,
) {
  if (!crossSiteInstall || !SIGN_IN_STARTS.has(ctx.path)) return;
  if (ctx.headers?.get("sec-fetch-site") !== "cross-site") return;
  const returned = ctx.context.returned as { url?: unknown } | undefined;
  if (typeof returned?.url !== "string") return;

  const cookie = browserCookie(ctx);
  ctx.setCookie(
    cookie.name,
    randomBytes(32).toString("base64url"),
    cookie.attributes,
  );

  // Better Auth checks an OAuth callback against a state cookie with the
  // install's partitioned attributes, which never reaches the callback either.
  // The same cookie again, unpartitioned, does.
  const state = ctx.path === "/sign-in/sso" ? null : stateIn(returned.url);
  if (state) {
    const stateCookie = ctx.context.createAuthCookie("state", {
      maxAge: STATE_COOKIE_MAX_AGE,
    });
    await ctx.setSignedCookie(stateCookie.name, state, ctx.context.secret, {
      ...stateCookie.attributes,
      partitioned: false,
    });
  }
}

/**
 * After a sign-in that ended on the API: when the browser carries the mark,
 * holds the session cookie back and returns where to send the browser instead,
 * the app's /auth/complete with a one-time token. Null to go on as usual.
 */
export async function handOffSession(
  ctx: Context & Pick<GenericEndpointContext, "path" | "getCookie">,
  clientUrl: string,
): Promise<string | null> {
  if (!endsOnTheApi(ctx.path)) return null;
  const browser = ctx.getCookie(browserCookie(ctx).name);
  const signedIn = ctx.context.newSession;
  const headers = ctx.context.responseHeaders;
  const location = headers?.get("location");
  if (!browser || !signedIn || !headers || !location) return null;

  const app = clientUrl.replace(/\/$/, "");
  let next: URL;
  try {
    next = new URL(location, app);
  } catch {
    return null;
  }
  if (next.origin !== new URL(app).origin) return null;

  const token = randomBytes(32).toString("base64url");
  await ctx.context.internalAdapter.createVerificationValue({
    identifier: `${TOKEN_PREFIX}${hash(token)}`,
    value: JSON.stringify({
      session: signedIn.session.token,
      browser: hash(browser),
      next: next.href,
    }),
    expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS),
  });

  // Set here, it would only sit under the API's site.
  const held = new Set([
    ctx.context.authCookies.sessionToken.name,
    ctx.context.authCookies.sessionData.name,
    ctx.context.authCookies.dontRememberToken.name,
  ]);
  const kept = (headers.getSetCookie() as string[]).filter(
    (cookie) => !held.has(cookie.slice(0, cookie.indexOf("="))),
  );
  headers.delete("set-cookie");
  for (const cookie of kept) headers.append("set-cookie", cookie);

  return `${app}${HANDOFF_APP_PATH}#token=${token}`;
}

/**
 * Both copies of Better Auth's OAuth state cookie (its partitioned one and the
 * one markCrossSiteSignIn adds), which outlive the sign-in otherwise. Cleared
 * from the app's page, so the partitioned one is the app's own.
 */
function clearStateCookies(
  ctx: Context & Pick<GenericEndpointContext, "setCookie">,
) {
  const state = ctx.context.createAuthCookie("state");
  ctx.setCookie(state.name, "", { ...state.attributes, maxAge: 0 });
  ctx.setCookie(state.name, "", {
    ...state.attributes,
    partitioned: false,
    maxAge: 0,
  });
}

const refused = (ctx: Context & Pick<GenericEndpointContext, "setCookie">) => {
  clearStateCookies(ctx);
  return new APIError("BAD_REQUEST", {
    code: "SIGN_IN_HANDOFF_INVALID",
    message: "This sign-in can't be finished here. Sign in again.",
  });
};

/** The app's half: redeems the token, in the browser it was made for. */
export const authHandoff = () =>
  ({
    id: "auth-handoff",
    endpoints: {
      redeemSignInHandoff: createAuthEndpoint(
        "/handoff/redeem",
        {
          method: "POST",
          body: z.object({ token: z.string().min(1).max(128) }),
          metadata: {
            ...HIDE_METADATA,
            openapi: {
              operationId: "redeemSignInHandoff",
              summary: "Finish a provider sign-in in the app",
              description:
                "With the app and API on different sites, a sign-in through SAML or OAuth ends by sending the browser to the app with a one-time token. The app posts it here, from the same browser, and gets the session cookie. A token works once, for a minute.",
              responses: {
                "200": { description: "Signed in; where to go next" },
                "400": {
                  description:
                    "The token is unknown, used, expired or from another browser",
                },
              },
            },
          },
        },
        async (ctx) => {
          // Used up whatever happens next, so a token gets one try.
          const record =
            await ctx.context.internalAdapter.consumeVerificationValue(
              `${TOKEN_PREFIX}${hash(ctx.body.token)}`,
            );
          if (!record || record.expiresAt.getTime() <= Date.now()) {
            throw refused(ctx);
          }
          let stored: { session?: unknown; browser?: unknown; next?: unknown };
          try {
            stored = JSON.parse(record.value);
          } catch {
            throw refused(ctx);
          }
          const cookie = browserCookie(ctx);
          const browser = ctx.getCookie(cookie.name);
          if (
            typeof stored.session !== "string" ||
            !browser ||
            stored.browser !== hash(browser)
          ) {
            throw refused(ctx);
          }
          const session = await ctx.context.internalAdapter.findSession(
            stored.session,
          );
          if (!session || session.session.expiresAt.getTime() <= Date.now()) {
            throw refused(ctx);
          }
          await setSessionCookie(ctx, session);
          expireCookie(ctx, cookie);
          clearStateCookies(ctx);
          return ctx.json({
            redirectTo: typeof stored.next === "string" ? stored.next : null,
          });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
