import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { refreshInstanceSettings } from "../../apps/api/src/instance-settings/snapshot";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  adminRequest,
  authPost,
  issuedCookies,
  ORIGIN,
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

// The API's address is read once, when the auth module loads, so this file is the
// HTTPS instance and saml-sign-in.test.ts is the plain-HTTP one.
vi.hoisted(() => {
  process.env.MARGAYA_API_URL = "https://margaya.example.test";
});

// Someone with an account at the identity provider can capture their own unused
// response and auto-post it from their page. Everything about it is valid, so what
// has to stop it is that this browser never started that sign-in.

type App = ReturnType<typeof createApp>["app"];
type Connection = { acsUrl: string; entityId: string };

const CALLBACK = `${ORIGIN}/dashboard`;
const SIGN_IN = `${ORIGIN}/auth/sign-in`;

let app: App;
let admin: Awaited<ReturnType<typeof signUpWithSession>>;
let connection: Connection;

/** A browser starting sign-in: what it gets back, and what it now holds. */
async function startSignIn(email: string) {
  const response = await authPost(app, "/sign-in/sso", {
    email,
    callbackURL: CALLBACK,
    errorCallbackURL: SIGN_IN,
    providerType: "saml",
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const { url } = (await response.json()) as { url: string };
  return {
    response,
    request: readAuthnRequest(url),
    cookies: issuedCookies(response),
  };
}

/** The response the identity provider would post for one person's request. */
function answer(
  started: Awaited<ReturnType<typeof startSignIn>>,
  email: string,
) {
  return samlPostBody(
    samlResponse({
      acsUrl: connection.acsUrl,
      audience: connection.entityId,
      email,
      inResponseTo: started.request.id,
    }),
    started.request.relayState,
  );
}

function post(body: string, cookie?: string) {
  return app.request(new URL(connection.acsUrl).pathname, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Origin: "https://idp.example.test",
      ...(cookie ? { cookie } : {}),
    },
    body,
  });
}

const hasSessionCookie = (response: Response) =>
  issuedCookies(response).includes("session_token=");

async function userId(email: string) {
  const [row] = await db
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);
  return row?.id;
}

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  app = createApp().app;
  admin = await signUpWithSession(app, "admin@example.com");
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
  expect(connection.acsUrl).toMatch(/^https:\/\/margaya\.example\.test\//);
});

describe("a sign-in on an HTTPS instance", () => {
  it("leaves a cookie that survives the identity provider's cross-site post", async () => {
    const { response } = await startSignIn("pat@acme.example");
    const binding = response.headers
      .getSetCookie()
      .filter((cookie) => cookie.includes("saml_request"));
    expect(binding).toHaveLength(1);
    expect(binding[0]).toMatch(/;\s*SameSite=None/i);
    expect(binding[0]).toMatch(/;\s*Secure/i);
    expect(binding[0]).toMatch(/;\s*HttpOnly/i);
    expect(binding[0]).toMatch(/;\s*Path=\/api\/auth\/sso\/saml2\/sp\/acs/i);
    // A partitioned cookie set during sign-in wouldn't come back on the post.
    expect(binding[0]).not.toMatch(/Partitioned/i);
  });

  it("finishes in the browser that started it", async () => {
    const started = await startSignIn("pat@acme.example");
    const response = await post(
      answer(started, "pat@acme.example"),
      started.cookies,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(CALLBACK);
    expect(hasSessionCookie(response)).toBe(true);
  });

  it("won't sign someone in to an account whose response was posted at them", async () => {
    const attacker = await startSignIn("attacker@acme.example");
    const captured = answer(attacker, "attacker@acme.example");

    const refused = await post(captured);
    expect(hasSessionCookie(refused)).toBe(false);
    expect(refused.status).toBe(302);
    expect(
      new URL(refused.headers.get("location") ?? "").searchParams.get("error"),
    ).toBe("saml_other_browser");
    expect(await userId("attacker@acme.example")).toBeUndefined();
  });

  it("isn't fooled by the victim having started a sign-in of their own", async () => {
    const victim = await startSignIn("pat@acme.example");
    const attacker = await startSignIn("attacker@acme.example");

    const refused = await post(
      answer(attacker, "attacker@acme.example"),
      victim.cookies,
    );
    expect(hasSessionCookie(refused)).toBe(false);

    // The victim's own sign-in is untouched.
    const response = await post(
      answer(victim, "pat@acme.example"),
      victim.cookies,
    );
    expect(hasSessionCookie(response)).toBe(true);
  });

  it("doesn't use up the request when it refuses, so nobody can spoil a sign-in", async () => {
    const started = await startSignIn("pat@acme.example");
    const body = answer(started, "pat@acme.example");

    expect(hasSessionCookie(await post(body))).toBe(false);
    expect(hasSessionCookie(await post(body, started.cookies))).toBe(true);
  });

  it("lets two sign-ins run side by side in one browser", async () => {
    const first = await startSignIn("pat@acme.example");
    const second = await startSignIn("sam@acme.example");
    const browser = `${first.cookies}; ${second.cookies}`;

    expect(
      hasSessionCookie(await post(answer(first, "pat@acme.example"), browser)),
    ).toBe(true);
    expect(
      hasSessionCookie(await post(answer(second, "sam@acme.example"), browser)),
    ).toBe(true);
  });

  it("still can't play a response back a second time", async () => {
    const started = await startSignIn("pat@acme.example");
    const body = answer(started, "pat@acme.example");
    expect(hasSessionCookie(await post(body, started.cookies))).toBe(true);
    expect(hasSessionCookie(await post(body, started.cookies))).toBe(false);
  });
});
