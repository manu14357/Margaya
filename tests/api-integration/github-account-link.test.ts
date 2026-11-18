import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { refreshInstanceSettings } from "../../apps/api/src/instance-settings/snapshot";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  authPost,
  issuedCookies,
  ORIGIN,
  resetInstanceState,
  signUpWithSession,
  unlockSignUpSettings,
} from "./helpers/instance-admin";

type App = ReturnType<typeof createApp>["app"];

const SETTINGS = `${ORIGIN}/dashboard/settings/projects/p/integrations`;

let app: App;

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  unlockSignUpSettings();
  await db.insert(schema.instanceSettingTable).values([
    { key: "oauth.github.clientId", value: "github-client-id" },
    { key: "oauth.github.clientSecret", value: "github-client-secret" },
  ]);
  await refreshInstanceSettings();
  app = createApp().app;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** GitHub's token and user endpoints, answering for one GitHub identity. */
function fakeGithub(email: string) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
      return json({
        access_token: "gho_test",
        token_type: "bearer",
        scope: "read:user,user:email",
      });
    }
    if (url === "https://api.github.com/user") {
      return json({
        id: 4242,
        login: "someone",
        name: "Someone",
        email,
        avatar_url: "",
      });
    }
    if (url === "https://api.github.com/user/emails") {
      return json([{ email, primary: true, verified: true }]);
    }
    return realFetch(input, init);
  });
}

/** Starts linking as the signed-in user and comes back from GitHub. */
async function linkGithub(cookie: string) {
  const start = await authPost(
    app,
    "/link-social",
    {
      provider: "github",
      callbackURL: SETTINGS,
      errorCallbackURL: `${SETTINGS}?linkError=github`,
      disableRedirect: true,
    },
    { cookie },
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") ?? "";
  const stateCookie = issuedCookies(start);
  const back = await app.request(
    `/api/auth/callback/github?code=test-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: [cookie, stateCookie].filter(Boolean).join("; ") } },
  );
  return back.headers.get("location") ?? "";
}

async function githubAccountOf(userId: string) {
  return db.query.accountTable.findFirst({
    where: and(
      eq(schema.accountTable.userId, userId),
      eq(schema.accountTable.providerId, "github"),
    ),
  });
}

describe("linking a GitHub account from settings", () => {
  it("links a GitHub account whose email differs from the Margaya account", async () => {
    const { cookie, user } = await signUpWithSession(app, "work@example.com");
    fakeGithub("personal@example.org");
    const location = await linkGithub(cookie);
    expect(location).toBe(SETTINGS);
    expect(await githubAccountOf(user.id)).toBeDefined();
  });

  it("links a GitHub account with the same email", async () => {
    const { cookie, user } = await signUpWithSession(app, "same@example.com");
    fakeGithub("same@example.com");
    expect(await linkGithub(cookie)).toBe(SETTINGS);
    expect(await githubAccountOf(user.id)).toBeDefined();
  });
});
