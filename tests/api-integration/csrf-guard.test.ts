import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { createApiKey } from "./helpers/api-keys";
import {
  ORIGIN,
  resetInstanceState,
  signUpWithSession,
} from "./helpers/instance-admin";

// Cookie-authenticated writes must come from a trusted origin (0.1). The
// setup trusts MARGAYA_CLIENT_URL=http://localhost:5173 and
// MARGAYA_API_URL=http://localhost:1337.

type App = ReturnType<typeof createApp>["app"];

const FOREIGN = "https://attacker.example";
const REFUSED = "Cross-site request refused";

let app: App;
let session: Awaited<ReturnType<typeof signUpWithSession>>;

beforeEach(async () => {
  await resetInstanceState();
  app = createApp().app;
  session = await signUpWithSession(app, "csrf@example.com");
});

afterEach(() => vi.unstubAllEnvs());

// A cookie-authenticated write with no other side effect: revoking an
// unknown session answers 404 once the request is let through.
function revokeUnknownSession(headers: Record<string, string>) {
  return app.request("/api/user/sessions/unknown-session", {
    method: "DELETE",
    headers: { cookie: session.cookie, ...headers },
  });
}

describe("API integration: CSRF guard on cookie-authenticated writes", () => {
  it("lets a write from the web app's origin through", async () => {
    const response = await revokeUnknownSession({ origin: ORIGIN });
    expect(response.status, await response.clone().text()).toBe(404);
  });

  it("lets a write from a CORS_ORIGINS entry through", async () => {
    vi.stubEnv("CORS_ORIGINS", "https://second.example");
    const response = await revokeUnknownSession({
      origin: "https://second.example",
    });
    expect(response.status).toBe(404);
  });

  it("refuses a write from a foreign origin with 403", async () => {
    const response = await revokeUnknownSession({ origin: FOREIGN });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain(REFUSED);
  });

  it("refuses a foreign Referer when the Origin is missing", async () => {
    const response = await revokeUnknownSession({
      referer: `${FOREIGN}/form.html`,
    });
    expect(response.status).toBe(403);
  });

  it("refuses a missing Origin when the browser says the request is cross-site", async () => {
    const response = await revokeUnknownSession({
      "sec-fetch-site": "cross-site",
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain(REFUSED);
  });

  it("lets a cookie without any browser headers through (a script, not a browser)", async () => {
    const response = await revokeUnknownSession({});
    expect(response.status).toBe(404);
  });

  it("never blocks reads", async () => {
    const response = await app.request("/api/user/security", {
      headers: { cookie: session.cookie, origin: FOREIGN },
    });
    expect(response.status).toBe(200);
  });

  it("does not apply to API-key callers, whatever their origin", async () => {
    const key = await createApiKey({ id: session.user.id });
    const response = await app.request("/api/user/avatar", {
      method: "DELETE",
      headers: { ...key.headers, cookie: session.cookie, origin: FOREIGN },
    });
    expect(response.status, await response.clone().text()).toBe(200);

    const viaHeader = await app.request("/api/user/avatar", {
      method: "DELETE",
      headers: { "x-api-key": key.key, origin: FOREIGN },
    });
    expect(viaHeader.status).toBe(200);
  });

  it("guards Better Auth's account routes too", async () => {
    const forged = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie: session.cookie, origin: FOREIGN },
    });
    expect(forged.status).toBe(403);
    expect(await forged.text()).toContain(REFUSED);

    const fromApp = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie: session.cookie, origin: ORIGIN },
    });
    expect(fromApp.status).toBe(200);
  });

  it("leaves signed webhooks to their signature checks", async () => {
    const response = await app.request("/api/github-integration/webhook", {
      method: "POST",
      headers: {
        cookie: session.cookie,
        origin: FOREIGN,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(await response.text()).not.toContain(REFUSED);
  });

  it("sends the API security headers on every response", async () => {
    const response = await app.request("/api/health");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    // The test API URL is plain HTTP.
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });
});
