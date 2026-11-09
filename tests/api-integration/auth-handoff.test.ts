import { like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { refreshInstanceSettings } from "../../apps/api/src/instance-settings/snapshot";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  adminRequest,
  authPost,
  resetInstanceState,
  signUpWithSession,
  unlockSignUpSettings,
} from "./helpers/instance-admin";
import {
  IDP_CERT,
  IDP_ENTRY_POINT,
  IDP_ISSUER,
  readAuthnRequest,
  samlPostBody,
  samlResponse,
} from "./helpers/saml-idp";

// The app and API on different sites over HTTPS: the session cookie is
// partitioned, so a sign-in that ends on the API hands the session to the app
// (utils/auth-handoff.ts). Read once, when the auth module loads.
vi.hoisted(() => {
  process.env.MARGAYA_API_URL = "https://api.margaya.example.net";
  process.env.MARGAYA_CLIENT_URL = "https://app.margaya.example.com";
  process.env.CUSTOM_OAUTH_CLIENT_ID = "margaya-test";
  process.env.CUSTOM_OAUTH_CLIENT_SECRET = "throwaway-test-secret";
  process.env.CUSTOM_OAUTH_AUTHORIZATION_URL = "https://id.example.test/auth";
  process.env.CUSTOM_OAUTH_TOKEN_URL = "https://id.example.test/token";
  process.env.CUSTOM_OAUTH_USER_INFO_URL = "https://id.example.test/userinfo";
});

type App = ReturnType<typeof createApp>["app"];
type Connection = { acsUrl: string; entityId: string };

const APP = "https://app.margaya.example.com";
const CALLBACK = `${APP}/dashboard`;
const COMPLETE = `${APP}/auth/complete#token=`;

let app: App;
let connection: Connection;

/** Cookies a response set, by name, as `name=value`. */
function cookiesOf(response: Response) {
  const jar = new Map<string, string>();
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(";")[0] ?? "";
    const name = pair.slice(0, pair.indexOf("="));
    if (pair.slice(name.length + 1)) jar.set(name, pair);
  }
  return jar;
}

const pick = (jar: Map<string, string>, part: string) =>
  [...jar].filter(([name]) => name.includes(part)).map(([, pair]) => pair);

/**
 * A browser on the app starting company sign-in. `site` is what it says about
 * the app and API: "cross-site" when they are on different sites.
 */
async function startSaml(email: string, site = "cross-site") {
  const response = await authPost(
    app,
    "/sign-in/sso",
    {
      email,
      callbackURL: CALLBACK,
      errorCallbackURL: `${APP}/auth/sign-in`,
      providerType: "saml",
    },
    { Origin: APP, "sec-fetch-site": site },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const { url } = (await response.json()) as { url: string };
  const jar = cookiesOf(response);
  return {
    request: readAuthnRequest(url),
    binding: pick(jar, "saml_request_"),
    handoff: pick(jar, ".handoff"),
  };
}

/** The provider's post, carrying what the browser sends the API on top. */
async function finishSaml(
  started: Awaited<ReturnType<typeof startSaml>>,
  email: string,
) {
  return app.request(new URL(connection.acsUrl).pathname, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Origin: "null",
      cookie: [...started.binding, ...started.handoff].join("; "),
    },
    body: samlPostBody(
      samlResponse({
        acsUrl: connection.acsUrl,
        audience: connection.entityId,
        email,
        inResponseTo: started.request.id,
      }),
      started.request.relayState,
    ),
  });
}

function tokenIn(response: Response) {
  const location = response.headers.get("location") ?? "";
  expect(location.startsWith(COMPLETE), location).toBe(true);
  return location.slice(COMPLETE.length);
}

/** The app's fetch to redeem a token, from a browser holding `cookies`. */
function redeem(token: string, cookies: string[]) {
  return app.request("/api/auth/handoff/redeem", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: APP,
      ...(cookies.length ? { cookie: cookies.join("; ") } : {}),
    },
    body: JSON.stringify({ token }),
  });
}

async function signedInAs(response: Response) {
  const session = pick(cookiesOf(response), "session_token");
  if (!session.length) return null;
  const answer = await app.request("/api/auth/get-session", {
    headers: { cookie: session.join("; ") },
  });
  const body = (await answer.json()) as { user?: { email: string } } | null;
  return body?.user?.email ?? null;
}

async function expectRefused(response: Response) {
  expect(response.status).toBe(400);
  expect(await response.clone().json()).toMatchObject({
    code: "SIGN_IN_HANDOFF_INVALID",
  });
  expect(pick(cookiesOf(response), "session_token")).toEqual([]);
}

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  app = createApp().app;
  const admin = await signUpWithSession(app, "admin@example.com");
  unlockSignUpSettings();
  await refreshInstanceSettings();
  const created = await adminRequest(
    app,
    "POST",
    "/identity/saml",
    admin.cookie,
    {
      name: "Company sign-in",
      domains: ["acme.example"],
      issuer: IDP_ISSUER,
      entryPoint: IDP_ENTRY_POINT,
      certificate: IDP_CERT,
    },
  );
  expect(created.status, await created.clone().text()).toBe(200);
  connection = (await created.json()) as Connection;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SAML sign-in with the app on another site", () => {
  it("hands the session to the app instead of keeping it on the API", async () => {
    const started = await startSaml("pat@acme.example");
    expect(started.handoff).toHaveLength(1);

    const finished = await finishSaml(started, "pat@acme.example");
    expect(finished.status).toBe(302);
    expect(pick(cookiesOf(finished), "session_token")).toEqual([]);
    const token = tokenIn(finished);
    // Nothing of the token reaches a server: it rides in the fragment only.
    expect(finished.headers.get("location")).not.toContain("?");

    const redeemed = await redeem(token, started.handoff);
    expect(redeemed.status, await redeemed.clone().text()).toBe(200);
    expect(await redeemed.clone().json()).toEqual({ redirectTo: CALLBACK });
    expect(await signedInAs(redeemed)).toBe("pat@acme.example");
    // The browser's mark goes with it.
    expect(
      redeemed.headers
        .getSetCookie()
        .some((line) => line.includes(".handoff=;") && /Max-Age=0/i.test(line)),
    ).toBe(true);
  });

  it("stores only a hash of the token", async () => {
    const started = await startSaml("pat@acme.example");
    const token = tokenIn(await finishSaml(started, "pat@acme.example"));
    const rows = await db
      .select()
      .from(schema.verificationTable)
      .where(like(schema.verificationTable.identifier, "auth-handoff:%"));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("redeems a token once", async () => {
    const started = await startSaml("pat@acme.example");
    const token = tokenIn(await finishSaml(started, "pat@acme.example"));
    expect((await redeem(token, started.handoff)).status).toBe(200);
    await expectRefused(await redeem(token, started.handoff));
  });

  it("refuses a token after its minute", async () => {
    const started = await startSaml("pat@acme.example");
    const token = tokenIn(await finishSaml(started, "pat@acme.example"));
    await db
      .update(schema.verificationTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(like(schema.verificationTable.identifier, "auth-handoff:%"));
    await expectRefused(await redeem(token, started.handoff));
  });

  it("redeems only in the browser that signed in", async () => {
    const started = await startSaml("pat@acme.example");
    const token = tokenIn(await finishSaml(started, "pat@acme.example"));
    const elsewhere = await startSaml("sam@acme.example");
    await expectRefused(await redeem(token, elsewhere.handoff));
    // And it was used up by that try.
    await expectRefused(await redeem(token, started.handoff));

    const again = await startSaml("pat@acme.example");
    const second = tokenIn(await finishSaml(again, "pat@acme.example"));
    await expectRefused(await redeem(second, []));
  });

  it("won't sign someone in to the account whose token was sent to them", async () => {
    const attacker = await startSaml("attacker@acme.example");
    const theirs = tokenIn(await finishSaml(attacker, "attacker@acme.example"));

    // The victim opens /auth/complete#token=<theirs>, signed out or mid sign-in.
    await expectRefused(await redeem(theirs, []));
    const victim = await startSaml("pat@acme.example");
    const attackerAgain = await startSaml("attacker@acme.example");
    const another = tokenIn(
      await finishSaml(attackerAgain, "attacker@acme.example"),
    );
    await expectRefused(await redeem(another, victim.handoff));
  });

  it("won't take a desktop secret in place of the browser's mark", async () => {
    const started = await startSaml("pat@acme.example");
    const token = tokenIn(await finishSaml(started, "pat@acme.example"));
    const response = await app.request("/api/auth/handoff/redeem", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: APP },
      body: JSON.stringify({ token, desktopSecret: "anything-at-all" }),
    });
    await expectRefused(response);
  });

  it("still redeems a browser token sent with a stray desktop secret", async () => {
    const started = await startSaml("pat@acme.example");
    const token = tokenIn(await finishSaml(started, "pat@acme.example"));
    const response = await app.request("/api/auth/handoff/redeem", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: APP,
        cookie: started.handoff.join("; "),
      },
      body: JSON.stringify({ token, desktopSecret: "anything-at-all" }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await signedInAs(response)).toBe("pat@acme.example");
  });

  it("leaves same-site and same-origin sign-in as it was", async () => {
    for (const site of ["same-site", "same-origin"]) {
      const started = await startSaml("pat@acme.example", site);
      expect(started.handoff, site).toEqual([]);
      const finished = await finishSaml(started, "pat@acme.example");
      expect(finished.headers.get("location"), site).toBe(CALLBACK);
      expect(await signedInAs(finished), site).toBe("pat@acme.example");
    }
  });
});

describe("OAuth sign-in with the app on another site", () => {
  function provider() {
    const realFetch = globalThis.fetch;
    return vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = new URL(
          typeof input === "string" || input instanceof URL ? input : input.url,
        );
        if (url.href.startsWith("https://id.example.test/token")) {
          return Response.json({
            access_token: "throwaway-access-token",
            token_type: "Bearer",
            expires_in: 300,
          });
        }
        if (url.href.startsWith("https://id.example.test/userinfo")) {
          return Response.json({
            sub: "oauth-user-1",
            email: "olive@oauth.example",
            email_verified: true,
            name: "Olive Park",
          });
        }
        return realFetch(input, init);
      });
  }

  it("carries the state check and the session over to the app", async () => {
    provider();
    const start = await authPost(
      app,
      "/sign-in/oauth2",
      {
        providerId: "custom",
        callbackURL: CALLBACK,
        errorCallbackURL: `${APP}/auth/sign-in`,
      },
      { Origin: APP, "sec-fetch-site": "cross-site" },
    );
    expect(start.status, await start.clone().text()).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state") ?? "";

    // Two state cookies: the usual partitioned one, which stays with the app,
    // and an unpartitioned one, which reaches the callback on the API.
    const lines = start.headers.getSetCookie();
    const stateLines = lines.filter((line) => line.includes(".state="));
    expect(stateLines).toHaveLength(2);
    const reachesApi = stateLines.filter((line) => !/Partitioned/i.test(line));
    expect(reachesApi).toHaveLength(1);
    const handoff = pick(cookiesOf(start), ".handoff");
    expect(handoff).toHaveLength(1);

    const callback = await app.request(
      `/api/auth/oauth2/callback/custom?code=throwaway-code&state=${encodeURIComponent(state)}`,
      {
        headers: {
          cookie: [(reachesApi[0] ?? "").split(";")[0], ...handoff].join("; "),
        },
      },
    );
    expect(callback.status, await callback.clone().text()).toBe(302);
    expect(pick(cookiesOf(callback), "session_token")).toEqual([]);
    const token = tokenIn(callback);

    const redeemed = await redeem(token, handoff);
    expect(redeemed.status, await redeemed.clone().text()).toBe(200);
    expect(await signedInAs(redeemed)).toBe("olive@oauth.example");
    expectStateCookiesCleared(redeemed);

    // Refused too: a used token, and one that never existed.
    for (const attempt of [token, "no-such-token"]) {
      const again = await redeem(attempt, handoff);
      await expectRefused(again);
      expectStateCookiesCleared(again);
    }
  });
});

/** Both state cookies expire: the app's partitioned copy and the plain one. */
function expectStateCookiesCleared(response: Response) {
  const expired = response.headers
    .getSetCookie()
    .filter((line) => line.includes(".state=;") && /Max-Age=0/i.test(line));
  expect(expired.filter((line) => /Partitioned/i.test(line))).toHaveLength(1);
  expect(expired.filter((line) => !/Partitioned/i.test(line))).toHaveLength(1);
}
