import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "./openapi";

// The desktop sign-in endpoints (utils/desktop-sign-in.ts) are served by
// Better Auth, so, like auth-openapi.ts, they are documented on the registry.

const challengeFields = {
  state: z.string().openapi({
    description:
      "The app's own random value, 8-256 unreserved characters (A-Z a-z 0-9 . _ ~ -). It comes back unchanged in the callback.",
  }),
  code_challenge: z.string().openapi({
    description:
      "BASE64URL(SHA-256(code_verifier)) without padding: 43 characters.",
  }),
  code_challenge_method: z.literal("S256"),
};

const errorText = { "text/plain": { schema: z.string() } };

export function desktopSignInRoutes(registry: OpenAPIHono["openAPIRegistry"]) {
  registry.registerPath({
    method: "get",
    path: "/auth/desktop/sign-in",
    tags: ["Authentication"],
    operationId: "startDesktopSignIn",
    summary: "Start desktop sign-in",
    description:
      "Opened by Margaya Desktop in the system browser. Always redirects to the web app's `/desktop/authorize` page with the same query. That page asks the person to confirm (signing in first if needed) and mints the code through `POST /auth/desktop/authorize`; this route never mints one, so a link to it hands no code to anything.",
    security: [],
    request: {
      query: z.object({
        ...challengeFields,
        display: z.literal("code").optional().openapi({
          description: "Show the code to paste instead of opening the app.",
        }),
      }),
    },
    responses: {
      302: {
        description: "To the web app's `/desktop/authorize` page",
      },
      400: { description: "Missing or malformed query" },
      404: { description: "Desktop sign-in is turned off on this server" },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/auth/desktop/authorize",
    tags: ["Authentication"],
    operationId: "authorizeDesktopSignIn",
    summary: "Authorize desktop sign-in",
    description:
      "Called by the web app's `/desktop/authorize` page with the person's session, after they confirm. Mints a one-time code (a minute, single use) bound to the PKCE challenge and state, and returns it with the desktop callback URL to open: `com.margaya.desktop://auth/callback?code=…&state=…&server=<API origin>`. API keys and impersonation sessions are refused. Its own origin's session works on every install, including ones where the API and web app are on different sites.",
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: z.object(challengeFields) },
        },
      },
    },
    responses: {
      200: {
        description: "The code, and the callback URL that opens the app",
        content: {
          "application/json": {
            schema: z.object({
              code: z.string(),
              redirectTo: z.string().openapi({
                example:
                  "com.margaya.desktop://auth/callback?code=…&state=…&server=https%3A%2F%2Fmargaya.example.com",
              }),
            }),
          },
        },
      },
      400: { description: "Invalid body" },
      401: { description: "Not signed in, or signed in with an API key" },
      403: { description: "Request from an untrusted origin" },
      404: { description: "Desktop sign-in is turned off on this server" },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/auth/desktop/token",
    tags: ["Authentication"],
    operationId: "exchangeDesktopSignInCode",
    summary: "Exchange desktop sign-in code",
    description:
      "Trades the one-time code and its PKCE verifier for a new bearer session of the person who signed in, plus a one-time URL and secret that sign the app's window in through the web app's `/auth/complete` page. The code is used up by the first try, right or wrong. Send `Authorization: Bearer <token>` on later calls, including the `/api/ws/user` socket.",
    security: [],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z.object({
              code: z.string(),
              code_verifier: z.string().openapi({
                description: "43-128 unreserved characters.",
              }),
              state: z.string().optional().openapi({
                description:
                  "When sent, it must be the state the code was minted for.",
              }),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "The desktop session",
        content: {
          "application/json": {
            schema: z.object({
              token: z.string().openapi({
                description:
                  "Bearer session token. Keep it in the OS keychain.",
              }),
              webviewUrl: z.string().openapi({
                description:
                  "`<web app>/auth/complete#token=…`; works once, for a minute, and only with webviewSecret.",
              }),
              webviewSecret: z.string().openapi({
                description:
                  "Hand it to the window's /auth/complete page through the desktop bridge; the page sends it to `/auth/handoff/redeem` as `desktopSecret`. Never put it in a URL.",
              }),
              user: z.object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
                image: z.string().nullable(),
              }),
              expiresAt: z.string().openapi({ format: "date-time" }),
            }),
          },
        },
      },
      400: { description: "Invalid body" },
      401: {
        description:
          "Unknown, expired or used code, a verifier that doesn't match, or a different state",
        content: {
          "application/json": {
            schema: z.object({ code: z.string(), message: z.string() }),
          },
        },
      },
      403: { description: "The account is banned" },
      404: { description: "Desktop sign-in is turned off on this server" },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/auth/desktop/sign-out",
    tags: ["Authentication"],
    operationId: "signOutDesktop",
    summary: "Sign out desktop session",
    description:
      "Ends the session named by the bearer token; the browser's own session is not touched. A cookie alone is refused.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Signed out",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true) }),
          },
        },
      },
      401: { description: "No bearer session token, or not a valid one" },
      403: {
        description: "A bearer value that is neither a session nor an API key",
        content: errorText,
      },
    },
  });
}
