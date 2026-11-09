import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type BetterAuthPlugin,
  type GenericEndpointContext,
  HIDE_METADATA,
} from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import { z } from "zod";
import { createDesktopHandoff } from "./auth-handoff";
import {
  desktopSignInEnabled,
  publicApiUrl,
  publicWebUrl,
} from "./desktop-config";

// Margaya Desktop signs in through the system browser (RFC 8252): identity
// providers only ever see a normal browser, and the browser's own session is
// reused. The app makes a state and a PKCE verifier and opens
// /desktop/sign-in, which always sends the browser on to the web app's
// /desktop/authorize page. There the person confirms (signing in first if
// needed), and the page mints a one-time code bound to the verifier's S256
// challenge through POST /desktop/authorize, then opens the app's own scheme
// with it. The app trades code and verifier for a bearer session at
// /desktop/token, together with a one-time token and a secret its window uses
// to sign in through the usual /auth/complete page (auth-handoff.ts).
//
// Only a confirmed, same-origin request mints a code: a link that merely opens
// /desktop/sign-in in a signed-in browser hands no code to whatever app has
// claimed the scheme. The page also has the session on every install; on
// split-site installs the session cookie belongs to the app's site and never
// reaches a top-level visit to the API.
//
// The code is stored hashed, lasts a minute and is used up on the first try,
// right or wrong. The only redirect target is the fixed desktop scheme;
// nothing in the request can change it.

export const DESKTOP_CALLBACK_URL = "com.margaya.desktop://auth/callback";
export const DESKTOP_AUTHORIZE_APP_PATH = "/desktop/authorize";

const CODE_PREFIX = "desktop-sign-in:";
const CODE_LIFETIME_MS = 60_000;

// RFC 7636: an S256 challenge is 43 base64url characters; a verifier is
// 43-128 unreserved characters.
const challenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const verifier = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);
const state = z.string().regex(/^[A-Za-z0-9._~-]{8,256}$/);

const authorizeFields = {
  state,
  code_challenge: challenge,
  code_challenge_method: z.literal("S256"),
};

const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

function sameText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

type Context = Pick<
  GenericEndpointContext,
  "context" | "headers" | "request" | "getCookie" | "getSignedCookie"
>;

const unavailable = () => new APIError("NOT_FOUND");

const codeRefused = () =>
  new APIError("UNAUTHORIZED", {
    code: "DESKTOP_CODE_INVALID",
    message: "This sign-in code is invalid, expired or already used.",
  });

/**
 * The caller's own session, from a cookie or a bearer token. Never an API key
 * (the API key plugin lends those a session), and never an impersonation: a
 * desktop session would outlive both.
 */
async function signedInSession(ctx: Context) {
  if (ctx.headers?.get("x-api-key")) return null;
  const current = await getSessionFromCtx(
    ctx as unknown as GenericEndpointContext,
    { disableRefresh: true },
  ).catch(() => null);
  if (!current?.session || !current.user) return null;
  const stored = await ctx.context.internalAdapter.findSession(
    current.session.token,
  );
  if (
    !stored ||
    stored.session.id !== current.session.id ||
    stored.session.expiresAt.getTime() <= Date.now() ||
    (stored.session as { impersonatedBy?: string | null }).impersonatedBy
  ) {
    return null;
  }
  return stored;
}

type Authorization = {
  state: string;
  code_challenge: string;
};

/** Mints the one-time code and returns the app's callback URL with it. */
async function mintCode(
  ctx: Context,
  session: NonNullable<Awaited<ReturnType<typeof signedInSession>>>,
  request: Authorization,
) {
  const code = randomBytes(32).toString("base64url");
  await ctx.context.internalAdapter.createVerificationValue({
    identifier: `${CODE_PREFIX}${hash(code)}`,
    value: JSON.stringify({
      userId: session.user.id,
      challenge: request.code_challenge,
      state: hash(request.state),
      activeOrganizationId:
        (session.session as { activeOrganizationId?: string | null })
          .activeOrganizationId ?? null,
    }),
    expiresAt: new Date(Date.now() + CODE_LIFETIME_MS),
  });
  const callback = new URL(DESKTOP_CALLBACK_URL);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", request.state);
  callback.searchParams.set("server", publicApiUrl());
  return { code, redirectTo: callback.href };
}

function authorizePage(query: Record<string, string | undefined>) {
  const page = new URL(`${publicWebUrl()}${DESKTOP_AUTHORIZE_APP_PATH}`);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) page.searchParams.set(name, value);
  }
  return page.href;
}

export const desktopSignIn = () =>
  ({
    id: "desktop-sign-in",
    endpoints: {
      startDesktopSignIn: createAuthEndpoint(
        "/desktop/sign-in",
        {
          method: "GET",
          query: z.object({
            ...authorizeFields,
            display: z.literal("code").optional(),
          }),
          metadata: HIDE_METADATA,
        },
        async (ctx) => {
          if (!desktopSignInEnabled()) throw unavailable();
          throw ctx.redirect(authorizePage(ctx.query));
        },
      ),
      authorizeDesktopSignIn: createAuthEndpoint(
        "/desktop/authorize",
        {
          method: "POST",
          body: z.object(authorizeFields),
          metadata: HIDE_METADATA,
        },
        async (ctx) => {
          if (!desktopSignInEnabled()) throw unavailable();
          const session = await signedInSession(ctx);
          if (!session) throw new APIError("UNAUTHORIZED");
          ctx.setHeader("Cache-Control", "no-store");
          return ctx.json(await mintCode(ctx, session, ctx.body));
        },
      ),
      exchangeDesktopSignInCode: createAuthEndpoint(
        "/desktop/token",
        {
          method: "POST",
          body: z.object({
            code: z.string().min(1).max(128),
            code_verifier: verifier,
            state: state.optional(),
          }),
          metadata: HIDE_METADATA,
        },
        async (ctx) => {
          if (!desktopSignInEnabled()) throw unavailable();
          // Used up whatever happens next, so a code gets one try.
          const record =
            await ctx.context.internalAdapter.consumeVerificationValue(
              `${CODE_PREFIX}${hash(ctx.body.code)}`,
            );
          if (!record || record.expiresAt.getTime() <= Date.now()) {
            throw codeRefused();
          }
          let stored: {
            userId?: unknown;
            challenge?: unknown;
            state?: unknown;
            activeOrganizationId?: unknown;
          };
          try {
            stored = JSON.parse(record.value);
          } catch {
            throw codeRefused();
          }
          if (
            typeof stored.userId !== "string" ||
            typeof stored.challenge !== "string" ||
            !sameText(hash(ctx.body.code_verifier), stored.challenge) ||
            (ctx.body.state !== undefined &&
              (typeof stored.state !== "string" ||
                !sameText(hash(ctx.body.state), stored.state)))
          ) {
            throw codeRefused();
          }
          const user = await ctx.context.internalAdapter.findUserById(
            stored.userId,
          );
          if (!user) throw codeRefused();

          // A session of its own, so signing out of the app leaves the
          // browser signed in, and the other way round.
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            false,
            typeof stored.activeOrganizationId === "string"
              ? { activeOrganizationId: stored.activeOrganizationId }
              : undefined,
          );
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Couldn't start a session.",
            });
          }
          // The window's token redeems only with this secret, which the app
          // hands to the page through its bridge: a token alone, sent to
          // someone as a link, signs nobody in.
          const webviewSecret = randomBytes(32).toString("base64url");
          const webviewUrl = await createDesktopHandoff(
            ctx,
            session.token,
            publicWebUrl(),
            webviewSecret,
          );
          ctx.setHeader("Cache-Control", "no-store");
          return ctx.json({
            token: session.token,
            webviewUrl,
            webviewSecret,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              image: user.image ?? null,
            },
            expiresAt: session.expiresAt.toISOString(),
          });
        },
      ),
      signOutDesktop: createAuthEndpoint(
        "/desktop/sign-out",
        {
          method: "POST",
          metadata: HIDE_METADATA,
        },
        async (ctx) => {
          // Only the bearer token names the session to end; a cookie alone
          // never signs the app out.
          if (
            !/^Bearer\s+\S+$/i.test(ctx.headers?.get("authorization") ?? "")
          ) {
            throw new APIError("UNAUTHORIZED");
          }
          const session = await signedInSession(ctx);
          if (!session) throw new APIError("UNAUTHORIZED");
          await ctx.context.internalAdapter.deleteSession(
            session.session.token,
          );
          return ctx.json({ success: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
