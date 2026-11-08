import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// Better Auth refuses a POST to /api/auth that carries cookies from an origin it
// doesn't trust, but it skips that check under test (isTest()), so the other SAML
// files never meet it. On HTTPS the identity provider's post is cross-site and
// carries the SameSite=None cookie that binds it to the browser, with the
// provider's origin or "null" (as Keycloak's page sends). It gets through only
// because the SSO plugin lists its endpoints in skipOriginCheck. This file runs
// with the check on, so an upgrade that drops that list fails here.
const savedNodeEnv = vi.hoisted(() => {
  const saved = process.env.NODE_ENV;
  process.env.MARGAYA_API_URL = "https://margaya.example.test";
  // Read once, when Better Auth loads: anything but "test" turns the check on.
  process.env.NODE_ENV = "development";
  delete process.env.TEST;
  return saved;
});

afterAll(() => {
  process.env.NODE_ENV = savedNodeEnv;
});

type App = ReturnType<typeof createApp>["app"];
type Connection = { acsUrl: string; entityId: string };

const CALLBACK = `${ORIGIN}/dashboard`;
const IDP_ORIGIN = "https://idp.example.test";

let app: App;
let connection: Connection;

async function startSignIn(email: string) {
  const response = await authPost(app, "/sign-in/sso", {
    email,
    callbackURL: CALLBACK,
    errorCallbackURL: `${ORIGIN}/auth/sign-in`,
    providerType: "saml",
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const { url } = (await response.json()) as { url: string };
  return { request: readAuthnRequest(url), cookies: issuedCookies(response) };
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

describe("with Better Auth's origin check on", () => {
  it("is really on: a cookie-carrying post from another origin is refused", async () => {
    const attempt = (origin: string) =>
      authPost(
        app,
        "/sign-in/email",
        { email: "pat@acme.example", password: "not the password" },
        // Not a session cookie, so only Better Auth's own check looks at it.
        { Origin: origin, cookie: "unrelated=1" },
      );
    const foreign = await attempt(IDP_ORIGIN);
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    expect((await attempt(ORIGIN)).status).not.toBe(403);
  });

  it.each([IDP_ORIGIN, "null"])(
    "lets the provider's post from origin %s through with the binding cookie",
    async (origin) => {
      const started = await startSignIn("pat@acme.example");
      expect(started.cookies).toMatch(/saml_request_/);
      const body = samlPostBody(
        samlResponse({
          acsUrl: connection.acsUrl,
          audience: connection.entityId,
          email: "pat@acme.example",
          inResponseTo: started.request.id,
        }),
        started.request.relayState,
      );
      const response = await app.request(new URL(connection.acsUrl).pathname, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          Origin: origin,
          cookie: started.cookies,
        },
        body,
      });
      expect(response.status, await response.clone().text()).toBe(302);
      expect(response.headers.get("location")).toBe(CALLBACK);
      expect(issuedCookies(response)).toContain("session_token=");
    },
  );
});
