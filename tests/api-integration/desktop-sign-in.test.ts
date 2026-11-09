import { createHash, randomBytes } from "node:crypto";
import { like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { createApiKey } from "./helpers/api-keys";
import {
  authPost,
  ORIGIN,
  resetInstanceState,
  signUpWithSession,
} from "./helpers/instance-admin";

// Margaya Desktop's sign-in through the system browser
// (apps/api/src/utils/desktop-sign-in.ts). The integration setup serves the API
// at http://localhost:1337 and the app at http://localhost:5173.

type App = ReturnType<typeof createApp>["app"];

const CALLBACK = "com.margaya.desktop://auth/callback?";
const API = "http://localhost:1337";
const WEB = "http://localhost:5173";

let app: App;
let cookie: string;
let userId: string;

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: randomBytes(16).toString("base64url") };
}

function startUrl(
  request: { challenge: string; state: string },
  extra: Record<string, string> = {},
) {
  const query = new URLSearchParams({
    state: request.state,
    code_challenge: request.challenge,
    code_challenge_method: "S256",
    ...extra,
  });
  return `/api/auth/desktop/sign-in?${query}`;
}

/** The system browser opening the start URL. */
function start(
  request: { challenge: string; state: string },
  headers: Record<string, string> = {},
  extra: Record<string, string> = {},
) {
  return app.request(startUrl(request, extra), { headers });
}

function callbackOf(location: string) {
  expect(location.startsWith(CALLBACK), location).toBe(true);
  const url = new URL(location);
  return {
    code: url.searchParams.get("code") ?? "",
    state: url.searchParams.get("state"),
    server: url.searchParams.get("server"),
  };
}

/** The desktop core trading the code: no cookie, no Origin. */
function exchange(body: Record<string, unknown>) {
  return app.request("/api/auth/desktop/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The app's /desktop/authorize page confirming, from its own origin. */
function mint(
  request: { challenge: string; state: string },
  headers: Record<string, string> = { cookie },
) {
  return authPost(
    app,
    "/desktop/authorize",
    {
      state: request.state,
      code_challenge: request.challenge,
      code_challenge_method: "S256",
    },
    headers,
  );
}

async function signedInCode() {
  const request = pkce();
  const minted = await mint(request);
  expect(minted.status, await minted.clone().text()).toBe(200);
  const { code } = (await minted.json()) as { code: string };
  return { ...request, code };
}

/** The window's fetch from /auth/complete: no mark cookie. */
function redeem(token: string, desktopSecret?: string) {
  return app.request("/api/auth/handoff/redeem", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({
      token,
      ...(desktopSecret === undefined ? {} : { desktopSecret }),
    }),
  });
}

async function signedInDesktop() {
  const { code, verifier } = await signedInCode();
  const answer = await exchange({ code, code_verifier: verifier });
  expect(answer.status, await answer.clone().text()).toBe(200);
  const body = (await answer.json()) as TokenAnswer;
  return { ...body, windowToken: body.webviewUrl.split("#token=")[1] ?? "" };
}

async function codeRows() {
  return db
    .select()
    .from(schema.verificationTable)
    .where(like(schema.verificationTable.identifier, "desktop-sign-in:%"));
}

type TokenAnswer = {
  token: string;
  webviewUrl: string;
  webviewSecret: string;
  user: { id: string; name: string; email: string; image: string | null };
  expiresAt: string;
};

async function bearerSession(token: string) {
  const answer = await app.request("/api/auth/get-session", {
    headers: { authorization: `Bearer ${token}` },
  });
  return (await answer.json()) as { user?: { email: string } } | null;
}

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  app = createApp().app;
  const signedUp = await signUpWithSession(app, "pat@example.com");
  cookie = signedUp.cookie;
  userId = signedUp.user.id;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("desktop sign-in", () => {
  it("mints a code on the app's confirm page, and trades it for a bearer session", async () => {
    const request = pkce();
    const minted = await mint(request);
    expect(minted.status, await minted.clone().text()).toBe(200);
    expect(minted.headers.get("cache-control")).toBe("no-store");
    const { code, redirectTo } = (await minted.json()) as {
      code: string;
      redirectTo: string;
    };
    const callback = callbackOf(redirectTo);
    expect(callback.code).toBe(code);
    expect(callback.state).toBe(request.state);
    expect(callback.server).toBe(API);
    expect(callback.code).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const answer = await exchange({
      code: callback.code,
      code_verifier: request.verifier,
      state: request.state,
    });
    expect(answer.status, await answer.clone().text()).toBe(200);
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(answer.headers.getSetCookie()).toEqual([]);
    const body = (await answer.json()) as TokenAnswer;
    expect(body.user).toEqual({
      id: userId,
      name: "pat",
      email: "pat@example.com",
      image: null,
    });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(body.webviewUrl.startsWith(`${WEB}/auth/complete#token=`)).toBe(
      true,
    );
    expect(body.webviewSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.webviewUrl).not.toContain(body.webviewSecret);

    // The token is a bearer session for the API, apart from the browser's.
    expect((await bearerSession(body.token))?.user?.email).toBe(
      "pat@example.com",
    );
    const inbox = await app.request("/api/notification", {
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(inbox.status).toBe(200);
    const sessions = await db.select().from(schema.sessionTable);
    expect(sessions).toHaveLength(2);
  });

  it("signs the desktop window in through /auth/complete with its secret, once", async () => {
    const desktop = await signedInDesktop();
    const redeemed = await redeem(desktop.windowToken, desktop.webviewSecret);
    expect(redeemed.status, await redeemed.clone().text()).toBe(200);
    const sessionCookie = redeemed.headers
      .getSetCookie()
      .map((line) => line.split(";")[0] ?? "")
      .filter((pair) => pair.includes("session_token="));
    expect(sessionCookie).toHaveLength(1);
    const asCookie = await app.request("/api/auth/get-session", {
      headers: { cookie: sessionCookie.join("; ") },
    });
    const session = (await asCookie.json()) as {
      user: { id: string };
      session: { token: string };
    };
    expect(session.user.id).toBe(userId);
    // The window shares the desktop's session: signing out ends both.
    expect(session.session.token).toBe(desktop.token);

    const again = await redeem(desktop.windowToken, desktop.webviewSecret);
    expect(again.status).toBe(400);
  });

  it("refuses a window token without its secret or with a wrong one, like an unknown token", async () => {
    const refusals = [];
    for (const secret of [undefined, randomBytes(32).toString("base64url")]) {
      const desktop = await signedInDesktop();
      const refused = await redeem(desktop.windowToken, secret);
      expect(refused.status).toBe(400);
      expect(
        refused.headers
          .getSetCookie()
          .filter(
            (line) =>
              line.includes("session_token=") && !/Max-Age=0/i.test(line),
          ),
      ).toEqual([]);
      refusals.push(await refused.json());
      // One try: the right secret no longer helps.
      expect(
        (await redeem(desktop.windowToken, desktop.webviewSecret)).status,
      ).toBe(400);
    }
    const unknown = await redeem("no-such-token", "anything");
    expect(unknown.status).toBe(400);
    const unknownBody = await unknown.json();
    expect(unknownBody).toMatchObject({ code: "SIGN_IN_HANDOFF_INVALID" });
    expect(refusals).toEqual([unknownBody, unknownBody]);
  });

  it("refuses a wrong verifier and uses the code up", async () => {
    const { code, verifier } = await signedInCode();
    const wrong = await exchange({
      code,
      code_verifier: pkce().verifier,
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ code: "DESKTOP_CODE_INVALID" });
    expect((await exchange({ code, code_verifier: verifier })).status).toBe(
      401,
    );
  });

  it("refuses a state that doesn't match the code's", async () => {
    const { code, verifier } = await signedInCode();
    const answer = await exchange({
      code,
      code_verifier: verifier,
      state: pkce().state,
    });
    expect(answer.status).toBe(401);
  });

  it("refuses a code used once already", async () => {
    const { code, verifier } = await signedInCode();
    expect((await exchange({ code, code_verifier: verifier })).status).toBe(
      200,
    );
    const again = await exchange({ code, code_verifier: verifier });
    expect(again.status).toBe(401);
    expect(await db.select().from(schema.sessionTable)).toHaveLength(2);
  });

  it("refuses a code after its minute", async () => {
    const { code, verifier } = await signedInCode();
    await db
      .update(schema.verificationTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(like(schema.verificationTable.identifier, "desktop-sign-in:%"));
    expect((await exchange({ code, code_verifier: verifier })).status).toBe(
      401,
    );
  });

  it("refuses an unknown code and answers 400 to a malformed body", async () => {
    expect(
      (await exchange({ code: "no-such-code", code_verifier: pkce().verifier }))
        .status,
    ).toBe(401);
    expect((await exchange({ code: "x", code_verifier: "short" })).status).toBe(
      400,
    );
    expect((await exchange({ code_verifier: pkce().verifier })).status).toBe(
      400,
    );
  });

  it("stores only a hash of the code", async () => {
    const { code } = await signedInCode();
    const rows = await db
      .select()
      .from(schema.verificationTable)
      .where(like(schema.verificationTable.identifier, "desktop-sign-in:%"));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it("always sends the browser to the app's confirm page, signed in or not, minting nothing", async () => {
    for (const headers of [{}, { cookie }]) {
      const request = pkce();
      const response = await start(request, headers);
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.origin + location.pathname).toBe(
        `${WEB}/desktop/authorize`,
      );
      expect(Object.fromEntries(location.searchParams)).toEqual({
        state: request.state,
        code_challenge: request.challenge,
        code_challenge_method: "S256",
      });
    }
    expect(await codeRows()).toHaveLength(0);
  });

  it("sends the code-to-paste variant to the app's page too", async () => {
    const request = pkce();
    const response = await start(request, { cookie }, { display: "code" });
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(
      `${WEB}/desktop/authorize`,
    );
    expect(location.searchParams.get("display")).toBe("code");
  });

  it("refuses a challenge method other than S256 and a malformed challenge", async () => {
    const request = pkce();
    for (const query of [
      { code_challenge_method: "plain" },
      { code_challenge: "too-short" },
      { state: "x" },
    ]) {
      const params = new URLSearchParams({
        state: request.state,
        code_challenge: request.challenge,
        code_challenge_method: "S256",
        ...query,
      });
      const response = await app.request(
        `/api/auth/desktop/sign-in?${params}`,
        {
          headers: { cookie },
        },
      );
      expect(response.status, JSON.stringify(query)).toBe(400);
    }
  });

  it("lets the app's page mint the code from its own origin", async () => {
    const request = pkce();
    const body = {
      state: request.state,
      code_challenge: request.challenge,
      code_challenge_method: "S256",
    };
    const minted = await authPost(app, "/desktop/authorize", body, { cookie });
    expect(minted.status, await minted.clone().text()).toBe(200);
    const { code, redirectTo } = (await minted.json()) as {
      code: string;
      redirectTo: string;
    };
    expect(redirectTo.startsWith(CALLBACK)).toBe(true);
    expect(new URL(redirectTo).searchParams.get("code")).toBe(code);
    expect(
      (await exchange({ code, code_verifier: request.verifier })).status,
    ).toBe(200);

    // Signed out, or from a foreign page, it mints nothing.
    expect((await authPost(app, "/desktop/authorize", body)).status).toBe(401);
    expect(
      (
        await authPost(app, "/desktop/authorize", body, {
          cookie,
          Origin: "https://evil.example.test",
        })
      ).status,
    ).toBe(403);
  });

  it("never mints a desktop session from an API key", async () => {
    const { key } = await createApiKey({ id: userId });
    const request = pkce();
    const response = await start(request, { "x-api-key": key });
    expect(response.headers.get("location") ?? "").not.toContain(CALLBACK);
    const minted = await app.request("/api/auth/desktop/authorize", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        state: request.state,
        code_challenge: request.challenge,
        code_challenge_method: "S256",
      }),
    });
    // Refused by the API key plugin (403) or here (401): never a code.
    expect([401, 403]).toContain(minted.status);
    const asBearer = await start(request, { authorization: `Bearer ${key}` });
    expect(asBearer.headers.get("location") ?? "").not.toContain(CALLBACK);
  });

  it("signs the app out with its bearer token only", async () => {
    const { code, verifier } = await signedInCode();
    const { token } = (await (
      await exchange({ code, code_verifier: verifier })
    ).json()) as TokenAnswer;

    const signOut = (headers: Record<string, string>) =>
      app.request("/api/auth/desktop/sign-out", { method: "POST", headers });
    expect((await signOut({})).status).toBe(401);
    // Not a session, so the API treats it as an unknown API key.
    expect([401, 403]).toContain(
      (await signOut({ authorization: "Bearer not-a-token" })).status,
    );
    const done = await signOut({ authorization: `Bearer ${token}` });
    expect(done.status, await done.clone().text()).toBe(200);
    // A token that is no session any more reads as an unknown API key.
    expect((await bearerSession(token))?.user).toBeUndefined();
    const api = await app.request("/api/notification", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(api.status).toBe(401);
    // The browser's own session goes on.
    const browser = await app.request("/api/auth/get-session", {
      headers: { cookie },
    });
    expect(((await browser.json()) as { user?: { id: string } }).user?.id).toBe(
      userId,
    );
  });

  it("answers 404 everywhere when desktop sign-in is turned off", async () => {
    const { code, verifier, state, challenge } = await signedInCode();
    vi.stubEnv("DESKTOP_SIGN_IN_ENABLED", "false");
    expect((await start({ state, challenge }, { cookie })).status).toBe(404);
    expect((await exchange({ code, code_verifier: verifier })).status).toBe(
      404,
    );
    expect(
      (
        await authPost(
          app,
          "/desktop/authorize",
          {
            state,
            code_challenge: challenge,
            code_challenge_method: "S256",
          },
          { cookie },
        )
      ).status,
    ).toBe(404);
  });
});
