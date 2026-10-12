import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";

type SessionResponse = { user: { image: string | null; name: string } } | null;

function applyCookies(existing: string, response: Response) {
  const jar = new Map<string, string>();

  for (const pair of existing.split("; ").filter(Boolean)) {
    const [name, ...value] = pair.split("=");
    if (name) jar.set(name, value.join("="));
  }

  for (const setCookie of response.headers.getSetCookie()) {
    const [pair] = setCookie.split(";");
    const [name, ...value] = (pair ?? "").split("=");
    if (!name) continue;
    if (value.join("=") === "") {
      jar.delete(name);
      continue;
    }
    jar.set(name, value.join("="));
  }

  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function collectCookies(response: Response) {
  return applyCookies("", response);
}

async function signUp(app: ReturnType<typeof createApp>["app"]) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "avatar-session@example.com",
      password: "correct horse battery staple",
      name: "Avatar Session",
    }),
  });

  expect(response.status).toBe(200);
  const cookies = collectCookies(response);
  expect(cookies).not.toBe("");

  return cookies;
}

describe("API integration: session freshness after profile updates", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("serves the updated user on the next get-session, with or without disableCookieCache", async () => {
    const { app } = createApp();
    const cookies = await signUp(app);

    const update = await app.request("/api/auth/update-user", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookies },
      body: JSON.stringify({
        image: "/api/user/avatar/new-avatar-id",
        name: "Renamed User",
      }),
    });
    expect(update.status).toBe(200);

    // The session cookie cache is off (auth.ts), so every lookup reads the
    // database and a profile change shows up immediately.
    for (const path of [
      "/api/auth/get-session",
      "/api/auth/get-session?disableCookieCache=true",
    ]) {
      const session = (await (
        await app.request(path, { headers: { cookie: cookies } })
      ).json()) as SessionResponse;
      expect(session?.user.image, path).toBe("/api/user/avatar/new-avatar-id");
      expect(session?.user.name, path).toBe("Renamed User");
    }
  });
});
