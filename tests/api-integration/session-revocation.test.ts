import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";

type App = ReturnType<typeof createApp>["app"];

/** Every cookie the response set, as a Cookie header. */
function issuedCookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0] ?? "")
    .filter((pair) => pair.split("=").slice(1).join("=") !== "")
    .join("; ");
}

async function signUp(app: App) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "revoked-session@example.com",
      password: "correct horse battery staple",
      name: "Revoked Session",
    }),
  });
  expect(response.status).toBe(200);
  const cookies = issuedCookies(response);
  expect(cookies).toContain("better-auth.session_token=");
  return cookies;
}

describe("API integration: signing out revokes the session", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects every cookie issued at sign-in once the user signed out", async () => {
    const { app } = createApp();
    const cookies = await signUp(app);
    const replay = { headers: { cookie: cookies } };

    expect((await app.request("/api/invitation/pending", replay)).status).toBe(
      200,
    );

    const signOut = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie: cookies, "content-type": "application/json" },
      body: "{}",
    });
    expect(signOut.status).toBe(200);

    // A copied cookie pair (session_token plus any session_data cache) must
    // not outlive the sign-out, on Margaya routes or Better Auth's own.
    expect((await app.request("/api/invitation/pending", replay)).status).toBe(
      401,
    );
    expect(
      (await app.request("/api/notification-preferences", replay)).status,
    ).toBe(401);
    const session = await app.request("/api/auth/get-session", replay);
    expect(await session.json()).toBeNull();
    expect(
      (await app.request("/api/auth/organization/list", replay)).status,
    ).toBe(401);
  });

  it("issues no session_data cookie cache that could outlive a sign-out", async () => {
    const { app } = createApp();
    const cookies = await signUp(app);

    expect(cookies).not.toContain("session_data");
  });
});
