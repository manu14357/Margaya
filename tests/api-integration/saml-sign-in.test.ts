import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { ssoProviderTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { refreshInstanceSettings } from "../../apps/api/src/instance-settings/snapshot";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { createWorkspaceMember } from "./helpers/fixtures";
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
  IDP_KEY,
  OTHER_CERT,
  OTHER_KEY,
  type ResponseOptions,
  readAuthnRequest,
  samlPostBody,
  samlResponse,
} from "./helpers/saml-idp";

// SAML sign-in against a stand-in identity provider (helpers/saml-idp.ts): the
// responses are built and signed in these tests. No real identity provider was
// involved, so these prove how the server treats responses, not that a product
// interoperates.

type App = ReturnType<typeof createApp>["app"];

type Connection = {
  id: string;
  name: string;
  domains: string[];
  acsUrl: string;
  entityId: string;
  metadataUrl: string;
  certificateFingerprint: string;
  certificateExpiresAt: string;
};

const CALLBACK = `${ORIGIN}/dashboard`;
const SIGN_IN = `${ORIGIN}/auth/sign-in`;
const IDP_ORIGIN = "https://idp.example.test";
const API_ORIGIN = "http://localhost:1337";
const FORM = "application/x-www-form-urlencoded";

let app: App;
let admin: Awaited<ReturnType<typeof signUpWithSession>>;

const connectionBody = (overrides: Record<string, unknown> = {}) => ({
  name: "Company sign-in",
  domains: ["acme.example"],
  issuer: IDP_ISSUER,
  entryPoint: IDP_ENTRY_POINT,
  certificate: IDP_CERT,
  ...overrides,
});

async function connect(overrides: Record<string, unknown> = {}) {
  const response = await adminRequest(
    app,
    "POST",
    "/identity/saml",
    admin.cookie,
    connectionBody(overrides),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Connection;
}

/** A browser starting sign-in: the request, and the cookies it now holds. */
async function startSignIn(email: string, callbackURL = CALLBACK) {
  const response = await authPost(app, "/sign-in/sso", {
    email,
    callbackURL,
    errorCallbackURL: SIGN_IN,
    providerType: "saml",
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const { url } = (await response.json()) as { url: string };
  return { ...readAuthnRequest(url), cookie: issuedCookies(response) };
}

function acsPath(connection: Connection) {
  return new URL(connection.acsUrl).pathname;
}

const isRepostPage = (response: Response) =>
  response.status === 200 &&
  (response.headers.get("content-type") ?? "").startsWith("text/html");

const unescapeHtml = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/** What the browser sends when it submits the re-post page's form. */
function submittedForm(html: string) {
  const form = new URLSearchParams();
  for (const [, name, value] of html.matchAll(
    /<input type="hidden" name="([^"]+)" value="([^"]*)">/g,
  )) {
    form.set(name ?? "", unescapeHtml(value ?? ""));
  }
  return form.toString();
}

/**
 * The browser posting the identity provider's form back. That post is
 * cross-site, so on plain HTTP the browser's Lax cookies stay behind: only
 * `headers` go with it. When the server answers with its own page re-posting the
 * form, the browser submits that same-site, and `cookie` (what it holds for this
 * server) goes along.
 */
async function postToAcs(
  connection: Connection,
  body: string,
  {
    cookie,
    headers = {},
  }: { cookie?: string; headers?: Record<string, string> } = {},
) {
  const first = await app.request(acsPath(connection), {
    method: "POST",
    headers: { "content-type": FORM, Origin: IDP_ORIGIN, ...headers },
    body,
  });
  if (!isRepostPage(first)) return first;
  return app.request(acsPath(connection), {
    method: "POST",
    headers: {
      "content-type": FORM,
      Origin: API_ORIGIN,
      ...(cookie ? { cookie } : {}),
    },
    body: submittedForm(await first.text()),
  });
}

async function signIn(
  connection: Connection,
  email: string,
  overrides: Partial<ResponseOptions> = {},
) {
  const request = await startSignIn(email);
  const response = samlResponse({
    acsUrl: connection.acsUrl,
    audience: connection.entityId,
    email,
    inResponseTo: request.id,
    ...overrides,
  });
  return postToAcs(connection, samlPostBody(response, request.relayState), {
    cookie: request.cookie,
  });
}

const hasSessionCookie = (response: Response) =>
  issuedCookies(response).includes("session_token=");

async function expectRefused(response: Response) {
  expect(hasSessionCookie(response), "no session may be issued").toBe(false);
  expect(response.status).toBe(302);
  const location = response.headers.get("location") ?? "";
  expect(location).toContain("error=");
  return location;
}

/** The code the sign-in screen turns into words (auth.signIn.errors). */
const refusalOf = (location: string) =>
  new URL(location).searchParams.get("error");

/** Refused as a response that can't be accepted, which the screen words. */
async function expectBadResponse(response: Response) {
  expect(refusalOf(await expectRefused(response))).toBe(
    "invalid_saml_response",
  );
}

async function sessionOf(response: Response) {
  const cookie = issuedCookies(response);
  const session = await app.request("/api/auth/get-session", {
    headers: { cookie },
  });
  return (await session.json()) as {
    user: { id: string; email: string; emailVerified: boolean };
  } | null;
}

async function userRow(email: string) {
  const [row] = await db
    .select()
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);
  return row;
}

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  app = createApp().app;
  admin = await signUpWithSession(app, "admin@example.com");
  unlockSignUpSettings();
  await refreshInstanceSettings();
});

afterEach(() => vi.unstubAllEnvs());

describe("managing connections", () => {
  it("is for instance admins with a session only", async () => {
    const someone = await signUpWithSession(app, "someone@example.com");
    for (const [method, path, body] of [
      ["GET", "/identity/saml"],
      ["POST", "/identity/saml", connectionBody()],
      ["PATCH", "/identity/saml/any", { name: "x" }],
      ["DELETE", "/identity/saml/any"],
    ] as const) {
      const response = await adminRequest(
        app,
        method,
        path,
        someone.cookie,
        body,
      );
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("shows the addresses for the identity provider and never a key", async () => {
    const connection = await connect();
    expect(connection.acsUrl).toMatch(
      /^http:\/\/localhost:1337\/api\/auth\/sso\/saml2\/sp\/acs\/saml_/,
    );
    expect(connection.metadataUrl).toContain("/sso/saml2/sp/metadata");
    expect(connection.certificateFingerprint).toMatch(/^[0-9A-F:]+$/);

    const metadata = await app.request(
      new URL(connection.metadataUrl).pathname +
        new URL(connection.metadataUrl).search,
    );
    expect(metadata.status).toBe(200);
    const xml = await metadata.text();
    expect(xml).toContain(connection.acsUrl);
    expect(xml).toContain("EntityDescriptor");

    const [row] = await db
      .select()
      .from(ssoProviderTable)
      .where(eq(ssoProviderTable.id, connection.id));
    expect(row?.samlConfig).not.toContain("PRIVATE KEY");
    expect(row?.domainVerified).toBe(true);
  });

  it("gives the addresses before the connection exists, for the provider's setup", async () => {
    const draft = await adminRequest(
      app,
      "GET",
      "/identity/saml/new",
      admin.cookie,
    );
    expect(draft.status).toBe(200);
    const { key, acsUrl, entityId } = (await draft.json()) as {
      key: string;
      acsUrl: string;
      entityId: string;
    };
    const connection = await connect({ key });
    expect(connection.acsUrl).toBe(acsUrl);
    expect(connection.entityId).toBe(entityId);
    // The same key twice can't be two connections.
    const again = await adminRequest(
      app,
      "POST",
      "/identity/saml",
      admin.cookie,
      connectionBody({ key, domains: ["other.example"] }),
    );
    expect(again.status).toBe(409);
  });

  it("refuses a bad certificate without repeating it, and a private key", async () => {
    const garbage = await adminRequest(
      app,
      "POST",
      "/identity/saml",
      admin.cookie,
      connectionBody({ certificate: "very-secret-not-a-certificate" }),
    );
    expect(garbage.status).toBe(400);
    await expect(garbage.text()).resolves.not.toContain("very-secret");

    const key = await adminRequest(
      app,
      "POST",
      "/identity/saml",
      admin.cookie,
      connectionBody({ certificate: IDP_KEY }),
    );
    expect(key.status).toBe(400);
    const text = await key.text();
    expect(text).toContain("private key");
    expect(text).not.toContain(IDP_KEY.split("\n")[1]);
    expect(await db.select().from(ssoProviderTable)).toEqual([]);
  });

  it("refuses an expired certificate", async () => {
    const realNow = Date.now();
    const spy = vi
      .spyOn(Date, "now")
      .mockReturnValue(realNow + 200 * 365 * 86_400_000);
    const response = await adminRequest(
      app,
      "POST",
      "/identity/saml",
      admin.cookie,
      connectionBody(),
    );
    spy.mockRestore();
    // The session may read as old at that date; only a certificate refusal or a
    // re-authentication prompt is acceptable, never a created connection.
    expect(response.status).not.toBe(200);
    expect(await db.select().from(ssoProviderTable)).toEqual([]);
  });

  it("refuses a sign-on address that can't be redirected to safely", async () => {
    for (const entryPoint of [
      "javascript:alert(1)",
      "http://idp.example.test/sso",
      "data:text/html,x",
      "not a url",
    ]) {
      const response = await adminRequest(
        app,
        "POST",
        "/identity/saml",
        admin.cookie,
        connectionBody({ entryPoint }),
      );
      expect(response.status, entryPoint).toBe(400);
    }
  });

  it("gives a domain to only one connection, counting subdomains", async () => {
    await connect();
    for (const domains of [["acme.example"], ["sub.acme.example"]]) {
      const response = await adminRequest(
        app,
        "POST",
        "/identity/saml",
        admin.cookie,
        connectionBody({ domains }),
      );
      expect(response.status, domains[0]).toBe(409);
    }
    await connect({ domains: ["other.example"] });
  });

  it("changes a certificate without changing the provider's addresses", async () => {
    const connection = await connect();
    const response = await adminRequest(
      app,
      "PATCH",
      `/identity/saml/${connection.id}`,
      admin.cookie,
      { certificate: OTHER_CERT, name: "Renamed" },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const updated = (await response.json()) as Connection;
    expect(updated.name).toBe("Renamed");
    expect(updated.acsUrl).toBe(connection.acsUrl);
    expect(updated.entityId).toBe(connection.entityId);
    expect(updated.certificateFingerprint).not.toBe(
      connection.certificateFingerprint,
    );

    const oldKey = await signIn(updated, "pat@acme.example");
    await expectRefused(oldKey);
    const newKey = await signIn(updated, "pat@acme.example", {
      key: OTHER_KEY,
      cert: OTHER_CERT,
    });
    expect(hasSessionCookie(newKey)).toBe(true);
  });

  it("keeps the plugin's own management endpoints closed", async () => {
    const connection = await connect();
    const providerId = acsPath(connection).split("/").pop() ?? "";
    const signedIn = {
      cookie: admin.cookie,
      "content-type": "application/json",
      Origin: ORIGIN,
    };
    for (const [method, path, body] of [
      [
        "POST",
        "/sso/register",
        { providerId: "mine", issuer: "x", domain: "evil.example" },
      ],
      ["GET", "/sso/providers"],
      ["GET", `/sso/get-provider?providerId=${providerId}`],
      ["POST", "/sso/update-provider", { providerId, domain: "evil.example" }],
      ["POST", "/sso/delete-provider", { providerId }],
      ["POST", "/sso/request-domain-verification", { providerId }],
      ["POST", "/sso/verify-domain", { providerId }],
      ["POST", `/sso/saml2/callback/${providerId}`, { SAMLResponse: "x" }],
      ["GET", `/sso/saml2/logout/${providerId}`],
    ] as const) {
      const response = await app.request(`/api/auth${path}`, {
        method,
        headers: signedIn,
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(response.status, path).toBe(404);
    }
    expect(await db.select().from(ssoProviderTable)).toHaveLength(1);
  });

  it("shows on the sign-in screen only while one exists", async () => {
    const before = await app.request("/api/config");
    await expect(before.json()).resolves.toMatchObject({
      hasSamlSignIn: false,
    });
    const connection = await connect();
    const during = await app.request("/api/config");
    await expect(during.json()).resolves.toMatchObject({
      hasSamlSignIn: true,
    });
    await adminRequest(
      app,
      "DELETE",
      `/identity/saml/${connection.id}`,
      admin.cookie,
    );
    const after = await app.request("/api/config");
    await expect(after.json()).resolves.toMatchObject({
      hasSamlSignIn: false,
    });
  });

  it("stops sign-in when removed, and accounts stay", async () => {
    const connection = await connect();
    await signIn(connection, "pat@acme.example");
    const removed = await adminRequest(
      app,
      "DELETE",
      `/identity/saml/${connection.id}`,
      admin.cookie,
    );
    expect(removed.status).toBe(200);
    const user = await userRow("pat@acme.example");
    expect(user).toBeTruthy();
    const links = await db
      .select()
      .from(schema.accountTable)
      .where(eq(schema.accountTable.userId, user?.id ?? ""));
    expect(links).toEqual([]);

    const response = await authPost(app, "/sign-in/sso", {
      email: "pat@acme.example",
      callbackURL: CALLBACK,
    });
    expect(response.status).toBe(404);
  });

  it("sends a sign-in still at the provider when it's removed back to the sign-in screen", async () => {
    // Seen in a browser: the provider's post landed on the API's bare JSON 404.
    const connection = await connect();
    const request = await startSignIn("pat@acme.example");
    const body = samlPostBody(
      samlResponse({
        acsUrl: connection.acsUrl,
        audience: connection.entityId,
        email: "pat@acme.example",
        inResponseTo: request.id,
      }),
      request.relayState,
    );
    const removed = await adminRequest(
      app,
      "DELETE",
      `/identity/saml/${connection.id}`,
      admin.cookie,
    );
    expect(removed.status).toBe(200);

    const response = await postToAcs(connection, body, {
      cookie: request.cookie,
    });
    await expectBadResponse(response);
    expect(response.headers.get("location")).toMatch(
      new RegExp(`^${SIGN_IN}\\?`),
    );
    expect(await userRow("pat@acme.example")).toBeUndefined();
  });
});

describe("signing in", () => {
  it("creates an account for a valid response and starts a session", async () => {
    const connection = await connect();
    const response = await signIn(connection, "pat@acme.example", {
      attributes: { displayName: "Pat Lee" },
    });
    expect(response.status, await response.clone().text()).toBe(302);
    expect(response.headers.get("location")).toBe(CALLBACK);
    expect(hasSessionCookie(response)).toBe(true);

    const session = await sessionOf(response);
    expect(session?.user).toMatchObject({
      email: "pat@acme.example",
      emailVerified: true,
    });
    expect(await userRow("pat@acme.example")).toMatchObject({
      name: "Pat Lee",
      role: "user",
    });
  });

  it("signs the same person into the same account next time", async () => {
    const connection = await connect();
    const first = await sessionOf(await signIn(connection, "pat@acme.example"));
    const second = await sessionOf(
      await signIn(connection, "pat@acme.example"),
    );
    expect(second?.user.id).toBe(first?.user.id);
  });

  it("accepts a response signed on the response rather than the assertion", async () => {
    const connection = await connect();
    const response = await signIn(connection, "pat@acme.example", {
      sign: "response",
    });
    expect(hasSessionCookie(response)).toBe(true);
  });

  it("reads the email from an attribute when the NameID isn't one", async () => {
    const connection = await connect();
    const response = await signIn(connection, "pat@acme.example", {
      nameId: "employee-1234",
      attributes: { email: "pat@acme.example" },
    });
    const session = await sessionOf(response);
    expect(session?.user.email).toBe("pat@acme.example");
  });

  it("works with a session cookie already present, from another origin", async () => {
    const connection = await connect();
    const request = await startSignIn("pat@acme.example");
    const body = samlPostBody(
      samlResponse({
        acsUrl: connection.acsUrl,
        audience: connection.entityId,
        email: "pat@acme.example",
        inResponseTo: request.id,
      }),
      request.relayState,
    );
    const response = await postToAcs(connection, body, {
      headers: { cookie: admin.cookie },
      cookie: `${admin.cookie}; ${request.cookie}`,
    });
    expect(response.status, await response.clone().text()).toBe(302);
    expect(hasSessionCookie(response)).toBe(true);
  });

  it("accepts a provider whose clock runs a little ahead", async () => {
    // Its NotBefore is then in this server's future; the plugin allows five
    // minutes either way, and the SAML library has to as well.
    const connection = await connect();
    const response = await signIn(connection, "pat@acme.example", {
      clockAheadMs: 2 * 60_000,
    });
    expect(response.headers.get("location")).toBe(CALLBACK);
    expect(hasSessionCookie(response)).toBe(true);
  });

  it("finds the connection through a subdomain", async () => {
    await connect();
    const request = await startSignIn("pat@eu.acme.example");
    expect(request.destination).toBe(IDP_ENTRY_POINT);
  });

  it("answers 404 for a domain nobody connected", async () => {
    await connect();
    const response = await authPost(app, "/sign-in/sso", {
      email: "pat@elsewhere.example",
      callbackURL: CALLBACK,
    });
    expect(response.status).toBe(404);
  });

  it("never redirects to a callback on another site", async () => {
    const connection = await connect();
    // Better Auth's origin check is off under NODE_ENV=test, so this reaches the
    // assertion endpoint, which must still not send anyone there.
    const request = await startSignIn(
      "pat@acme.example",
      "https://evil.example/steal",
    );
    const response = await postToAcs(
      connection,
      samlPostBody(
        samlResponse({
          acsUrl: connection.acsUrl,
          audience: connection.entityId,
          email: "pat@acme.example",
          inResponseTo: request.id,
        }),
        request.relayState,
      ),
      { cookie: request.cookie },
    );
    expect(response.status).toBe(302);
    expect(hasSessionCookie(response)).toBe(true);
    expect(response.headers.get("location")).not.toContain("evil.example");
  });
});

// The provider's post is cross-site, and on plain HTTP only a Lax cookie is
// available, which stays behind on it. So the server answers with a page of its
// own that re-posts the form: that post is same-site and brings the cookie. The
// HTTPS instance, whose cookie survives the cross-site post, is in
// saml-browser-binding.test.ts.
describe("tying a response to the browser on plain HTTP", () => {
  const crossSitePost = (connection: Connection, body: string) =>
    app.request(acsPath(connection), {
      method: "POST",
      headers: { "content-type": FORM, Origin: IDP_ORIGIN },
      body,
    });

  const sameSitePost = (connection: Connection, body: string, cookie = "") =>
    app.request(acsPath(connection), {
      method: "POST",
      headers: {
        "content-type": FORM,
        Origin: API_ORIGIN,
        ...(cookie ? { cookie } : {}),
      },
      body,
    });

  const answer = (
    connection: Connection,
    started: Awaited<ReturnType<typeof startSignIn>>,
    email: string,
  ) =>
    samlPostBody(
      samlResponse({
        acsUrl: connection.acsUrl,
        audience: connection.entityId,
        email,
        inResponseTo: started.id,
      }),
      started.relayState,
    );

  it("leaves a Lax cookie when sign-in starts, since Secure isn't available", async () => {
    await connect();
    const response = await authPost(app, "/sign-in/sso", {
      email: "pat@acme.example",
      callbackURL: CALLBACK,
      errorCallbackURL: SIGN_IN,
      providerType: "saml",
    });
    const binding = response.headers
      .getSetCookie()
      .filter((cookie) => cookie.includes("saml_request"));
    expect(binding).toHaveLength(1);
    expect(binding[0]).toMatch(/;\s*SameSite=Lax/i);
    expect(binding[0]).toMatch(/;\s*HttpOnly/i);
    expect(binding[0]).toMatch(/;\s*Path=\/api\/auth\/sso\/saml2\/sp\/acs/i);
    expect(binding[0]).not.toMatch(/;\s*Secure/i);
  });

  it("answers the cross-site post with a page that re-posts it, and signs in on that", async () => {
    const connection = await connect();
    const started = await startSignIn("pat@acme.example");
    const body = answer(connection, started, "pat@acme.example");

    const page = await crossSitePost(connection, body);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);
    expect(page.headers.get("cache-control")).toContain("no-store");
    expect(hasSessionCookie(page)).toBe(false);
    const policy = page.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    const html = await page.text();
    // The form posts back to where it came from; the script is a file of ours.
    expect(html).toMatch(/<form method="post">/);
    expect(html).toContain(
      '<script src="/api/auth/sso/saml2/sp/continue.js"></script>',
    );

    const response = await sameSitePost(
      connection,
      submittedForm(html),
      started.cookie,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(CALLBACK);
    expect(hasSessionCookie(response)).toBe(true);
  });

  it("serves the script that submits the page", async () => {
    const script = await app.request("/api/auth/sso/saml2/sp/continue.js");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(await script.text()).toContain("submit()");
  });

  it("won't sign someone in to an account whose response was posted at them", async () => {
    const connection = await connect();
    const attacker = await startSignIn("attacker@acme.example");
    const captured = answer(connection, attacker, "attacker@acme.example");

    // The victim's browser follows the re-post, but holds no cookie for it.
    const refused = await postToAcs(connection, captured);
    expect(hasSessionCookie(refused)).toBe(false);
    expect(refusalOf(refused.headers.get("location") ?? "")).toBe(
      "saml_other_browser",
    );
    expect(await userRow("attacker@acme.example")).toBeUndefined();
  });

  it("isn't fooled by the victim having started a sign-in of their own", async () => {
    const connection = await connect();
    const victim = await startSignIn("pat@acme.example");
    const attacker = await startSignIn("attacker@acme.example");

    const refused = await postToAcs(
      connection,
      answer(connection, attacker, "attacker@acme.example"),
      { cookie: victim.cookie },
    );
    expect(hasSessionCookie(refused)).toBe(false);
    // The victim's own sign-in is untouched.
    const response = await postToAcs(
      connection,
      answer(connection, victim, "pat@acme.example"),
      { cookie: victim.cookie },
    );
    expect(hasSessionCookie(response)).toBe(true);
  });

  it("offers the re-post once, so it can't loop", async () => {
    const connection = await connect();
    const started = await startSignIn("pat@acme.example");
    const page = await crossSitePost(
      connection,
      answer(connection, started, "pat@acme.example"),
    );
    const resubmitted = submittedForm(await page.text());
    // The re-post arrives without the cookie: refused, not offered again.
    const refused = await sameSitePost(connection, resubmitted);
    expect(refused.status).toBe(302);
    expect(refusalOf(refused.headers.get("location") ?? "")).toBe(
      "saml_other_browser",
    );
    // A first post that already says it's the re-post gets no page either.
    const marked = await crossSitePost(connection, resubmitted);
    expect(marked.status).toBe(302);
    // Neither used the request up.
    expect(
      hasSessionCookie(
        await sameSitePost(connection, resubmitted, started.cookie),
      ),
    ).toBe(true);
  });

  it("repeats nothing it was sent without escaping it", async () => {
    const connection = await connect();
    const started = await startSignIn("pat@acme.example");
    const response = samlResponse({
      acsUrl: connection.acsUrl,
      audience: connection.entityId,
      email: "pat@acme.example",
      inResponseTo: started.id,
    });
    const hostile = `"><script>alert(1)</script><x a='`;
    const page = await crossSitePost(
      connection,
      samlPostBody(response, hostile),
    );
    const html = await page.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(new URLSearchParams(submittedForm(html)).get("RelayState")).toBe(
      hostile,
    );

    // Text around the base64 that the decoder would skip isn't repeated at all.
    const padded = await crossSitePost(
      connection,
      new URLSearchParams({
        SAMLResponse: `${response}"><img src=x onerror=alert(1)>`,
      }).toString(),
    );
    expect(padded.status).toBe(302);
    expect(await padded.text()).not.toContain("onerror");
  });

  it("asks for no re-post for a response that answers no request", async () => {
    const connection = await connect();
    const unsolicited = samlResponse({
      acsUrl: connection.acsUrl,
      audience: connection.entityId,
      email: "pat@acme.example",
      inResponseTo: null,
    });
    const response = await crossSitePost(connection, samlPostBody(unsolicited));
    expect(response.status).toBe(302);
    expect(refusalOf(response.headers.get("location") ?? "")).toBe(
      "unsolicited_response",
    );
  });

  it("keeps the strict content policy on every other API answer", async () => {
    const connection = await connect();
    const started = await startSignIn("pat@acme.example");
    const strict =
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
    // Only the re-post page brings its own.
    const page = await crossSitePost(
      connection,
      answer(connection, started, "pat@acme.example"),
    );
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).not.toBe(strict);
    const config = await app.request("/api/config");
    expect(config.headers.get("content-security-policy")).toBe(strict);
    const signedIn = await sameSitePost(
      connection,
      answer(connection, started, "pat@acme.example"),
      started.cookie,
    );
    expect(signedIn.status).toBe(302);
    expect(signedIn.headers.get("content-security-policy")).toBe(strict);
  });
});

describe("refusing a response", () => {
  it("with no signature", async () => {
    const connection = await connect();
    await expectBadResponse(
      await signIn(connection, "pat@acme.example", { sign: "none" }),
    );
    expect(await userRow("pat@acme.example")).toBeUndefined();
  });

  it("signed by another key, even carrying that key's certificate", async () => {
    const connection = await connect();
    await expectBadResponse(
      await signIn(connection, "pat@acme.example", {
        key: OTHER_KEY,
        cert: OTHER_CERT,
      }),
    );
    expect(await userRow("pat@acme.example")).toBeUndefined();
  });

  it("signed by another key while claiming the right certificate", async () => {
    const connection = await connect();
    await expectBadResponse(
      await signIn(connection, "pat@acme.example", {
        key: OTHER_KEY,
        cert: IDP_CERT,
      }),
    );
    expect(await userRow("pat@acme.example")).toBeUndefined();
  });

  it("changed after it was signed", async () => {
    const connection = await connect();
    const request = await startSignIn("pat@acme.example");
    const signed = samlResponse({
      acsUrl: connection.acsUrl,
      audience: connection.entityId,
      email: "pat@acme.example",
      inResponseTo: request.id,
    });
    const forged = Buffer.from(
      Buffer.from(signed, "base64")
        .toString()
        .replaceAll("pat@acme.example", "admin@acme.example"),
    ).toString("base64");
    // From the browser that started sign-in, so only the change is wrong.
    await expectBadResponse(
      await postToAcs(connection, samlPostBody(forged, request.relayState), {
        cookie: request.cookie,
      }),
    );
    expect(await userRow("admin@acme.example")).toBeUndefined();
  });

  it("with a second, unsigned assertion slipped in", async () => {
    const connection = await connect();
    const request = await startSignIn("pat@acme.example");
    const signed = Buffer.from(
      samlResponse({
        acsUrl: connection.acsUrl,
        audience: connection.entityId,
        email: "pat@acme.example",
        inResponseTo: request.id,
      }),
      "base64",
    ).toString();
    const evil = Buffer.from(
      samlResponse({
        acsUrl: connection.acsUrl,
        audience: connection.entityId,
        email: "admin@acme.example",
        inResponseTo: request.id,
        sign: "none",
      }),
      "base64",
    )
      .toString()
      .match(/<saml:Assertion[\s\S]*<\/saml:Assertion>/)?.[0];
    const wrapped = signed.replace("<saml:Assertion", `${evil}<saml:Assertion`);
    await expectBadResponse(
      await postToAcs(
        connection,
        samlPostBody(
          Buffer.from(wrapped).toString("base64"),
          request.relayState,
        ),
        { cookie: request.cookie },
      ),
    );
    expect(await userRow("admin@acme.example")).toBeUndefined();
  });

  it("from another issuer", async () => {
    const connection = await connect();
    await expectBadResponse(
      await signIn(connection, "pat@acme.example", {
        issuer: "https://other-idp.example.test",
      }),
    );
  });

  it("meant for another service", async () => {
    const connection = await connect();
    await expectBadResponse(
      await signIn(connection, "pat@acme.example", {
        audience: "https://other-service.example.test",
      }),
    );
  });

  it("meant for another address", async () => {
    const connection = await connect();
    await expectBadResponse(
      await signIn(connection, "pat@acme.example", {
        recipient: "https://other-service.example.test/acs",
      }),
    );
  });

  it("that has expired", async () => {
    const connection = await connect();
    await expectBadResponse(
      await signIn(connection, "pat@acme.example", {
        notOnOrAfter: new Date(Date.now() - 60 * 60_000),
      }),
    );
  });

  it("that this server never asked for", async () => {
    const connection = await connect();
    const unsolicited = samlResponse({
      acsUrl: connection.acsUrl,
      audience: connection.entityId,
      email: "pat@acme.example",
      inResponseTo: null,
    });
    await expectRefused(await postToAcs(connection, samlPostBody(unsolicited)));
    const madeUp = samlResponse({
      acsUrl: connection.acsUrl,
      audience: connection.entityId,
      email: "pat@acme.example",
      inResponseTo: "_never-issued",
    });
    await expectRefused(await postToAcs(connection, samlPostBody(madeUp)));
    expect(await userRow("pat@acme.example")).toBeUndefined();
  });

  it("answering a request made for another connection", async () => {
    const first = await connect();
    const second = await connect({
      name: "Second",
      domains: ["second.example"],
    });
    const request = await startSignIn("pat@acme.example");
    const crossed = samlResponse({
      acsUrl: second.acsUrl,
      audience: second.entityId,
      email: "pat@second.example",
      inResponseTo: request.id,
    });
    await expectBadResponse(
      await postToAcs(second, samlPostBody(crossed, request.relayState), {
        cookie: request.cookie,
      }),
    );
    expect(first.id).not.toBe(second.id);
    expect(await userRow("pat@second.example")).toBeUndefined();
  });

  it("played back a second time", async () => {
    const connection = await connect();
    const request = await startSignIn("pat@acme.example");
    const body = samlPostBody(
      samlResponse({
        acsUrl: connection.acsUrl,
        audience: connection.entityId,
        email: "pat@acme.example",
        inResponseTo: request.id,
      }),
      request.relayState,
    );
    const browser = { cookie: request.cookie };
    expect(hasSessionCookie(await postToAcs(connection, body, browser))).toBe(
      true,
    );
    await expectBadResponse(await postToAcs(connection, body, browser));
  });

  it("with a SHA-1 signature", async () => {
    const connection = await connect();
    const response = await signIn(connection, "pat@acme.example", {
      sha1: true,
    });
    const location = await expectRefused(response);
    expect(refusalOf(location)).toBe("saml_deprecated_algorithm");
    expect(await userRow("pat@acme.example")).toBeUndefined();
  });

  it("not XML at all", async () => {
    const connection = await connect();
    await expectRefused(
      await postToAcs(
        connection,
        samlPostBody(Buffer.from("not xml").toString("base64")),
      ),
    );
  });
});

describe("who may sign in", () => {
  it("not an address outside the connection's domains", async () => {
    const connection = await connect();
    const location = await expectRefused(
      await signIn(connection, "pat@acme.example", {
        nameId: "ceo@other.example",
        email: "ceo@other.example",
      }),
    );
    expect(location).toContain(SIGN_IN);
    expect(refusalOf(location)).toBe(
      "This_identity_provider_cannot_sign_in_that_email_address.",
    );
    expect(await userRow("ceo@other.example")).toBeUndefined();
  });

  it("not an existing account on another domain", async () => {
    const connection = await connect();
    await expectRefused(
      await signIn(connection, "pat@acme.example", {
        nameId: "admin@example.com",
        email: "admin@example.com",
      }),
    );
  });

  it("links an existing account whose address is verified", async () => {
    const connection = await connect();
    const existing = await signUpWithSession(app, "pat@acme.example");
    await db
      .update(schema.userTable)
      .set({ emailVerified: true })
      .where(eq(schema.userTable.id, existing.user.id));
    const session = await sessionOf(
      await signIn(connection, "pat@acme.example"),
    );
    expect(session?.user.id).toBe(existing.user.id);
  });

  it("won't link an account whose address nobody proved", async () => {
    const connection = await connect();
    // Someone could have pre-registered this address with a password of theirs.
    await signUpWithSession(app, "pat@acme.example");
    const response = await signIn(connection, "pat@acme.example");
    const location = await expectRefused(response);
    expect(location).toBe(`${SIGN_IN}?error=account_not_linked`);
  });

  it("not someone deactivated, by an admin or an identity provider", async () => {
    const connection = await connect();
    const first = await signIn(connection, "pat@acme.example");
    expect(hasSessionCookie(first)).toBe(true);
    await db
      .update(schema.userTable)
      .set({ banned: true })
      .where(eq(schema.userTable.email, "pat@acme.example"));
    const location = await expectRefused(
      await signIn(connection, "pat@acme.example"),
    );
    expect(refusalOf(location)).toBe("BANNED_USER");
  });

  it("new accounts follow invite-only", async () => {
    const connection = await connect();
    const saved = await adminRequest(app, "PATCH", "/settings", admin.cookie, {
      values: { "auth.inviteOnly": true },
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    await refreshInstanceSettings();

    await expectRefused(await signIn(connection, "pat@acme.example"));
    expect(await userRow("pat@acme.example")).toBeUndefined();

    const { workspace, user } = await createWorkspaceMember({
      workspaceName: "Acme",
    });
    await db.insert(schema.invitationTable).values({
      id: "invite-pat",
      email: "pat@acme.example",
      workspaceId: workspace.id,
      inviterId: user.id,
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(hasSessionCookie(await signIn(connection, "pat@acme.example"))).toBe(
      true,
    );
  });

  it("new accounts follow the allowed email domains", async () => {
    const connection = await connect();
    const saved = await adminRequest(app, "PATCH", "/settings", admin.cookie, {
      values: { "auth.allowedEmailDomains": "other.example" },
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    await refreshInstanceSettings();
    await expectRefused(await signIn(connection, "pat@acme.example"));
    expect(await userRow("pat@acme.example")).toBeUndefined();
  });

  it("not when another provider is required", async () => {
    await connect();
    const saved = await adminRequest(app, "PATCH", "/settings", admin.cookie, {
      values: { "auth.requiredProvider": "github" },
    });
    if (saved.status !== 200) return; // Refused without a configured provider.
    await refreshInstanceSettings();
    const config = await app.request("/api/config");
    await expect(config.json()).resolves.toMatchObject({
      hasSamlSignIn: false,
    });
    const response = await authPost(app, "/sign-in/sso", {
      email: "pat@acme.example",
      callbackURL: CALLBACK,
    });
    expect(response.status).toBe(403);
  });
});

describe("a provisioned person", () => {
  it("signs in with SAML into the account SCIM made, and not once deactivated", async () => {
    const connection = await connect();
    const { workspace } = await createWorkspaceMember({
      workspaceName: "Acme",
    });
    const scimResponse = await adminRequest(
      app,
      "POST",
      "/identity/scim",
      admin.cookie,
      { name: "Directory", workspaceId: workspace.id },
    );
    const { token } = (await scimResponse.json()) as { token: string };
    const provisioned = await app.request("/api/auth/scim/v2/Users", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        userName: "pat@acme.example",
        name: { formatted: "Pat Lee" },
      }),
    });
    expect(provisioned.status, await provisioned.clone().text()).toBe(201);
    const { id } = (await provisioned.json()) as { id: string };

    const session = await sessionOf(
      await signIn(connection, "pat@acme.example"),
    );
    expect(session?.user.id).toBe(id);

    await app.request(`/api/auth/scim/v2/Users/${id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: false }],
      }),
    });
    await expectRefused(await signIn(connection, "pat@acme.example"));
  });
});
