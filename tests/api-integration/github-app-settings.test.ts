import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { getGithubApp } from "../../apps/api/src/plugins/github/utils/github-app";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  adminRequest,
  resetInstanceState,
  signUpWithSession,
  unlockSignUpSettings,
} from "./helpers/instance-admin";

type App = ReturnType<typeof createApp>["app"];

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();

const VALUES = {
  "githubApp.appId": "123456",
  "githubApp.appName": "Margaya-Example",
  "githubApp.privateKey": PEM,
  "githubApp.webhookSecret": "webhook-secret",
};

let app: App;

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  unlockSignUpSettings();
  app = createApp().app;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type SettingsView = {
  settings: Array<{
    key: string;
    value?: unknown;
    configured: boolean;
    locked: boolean;
  }>;
  derived: {
    githubApp: {
      configured: boolean;
      managedByEnvironment: boolean;
      webhookUrl: string;
    };
  };
};

async function appInfo(cookie: string) {
  const response = await app.request("/api/github-integration/app-info", {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    appConfigured: boolean;
    appName: string | null;
  };
}

describe("GitHub App in the instance settings", () => {
  it("lets an instance admin set up the App without environment variables", async () => {
    const admin = await signUpWithSession(app, "admin@example.com");
    expect(getGithubApp()).toBeNull();
    expect((await appInfo(admin.cookie)).appConfigured).toBe(false);

    const saved = await adminRequest(app, "PATCH", "/settings", admin.cookie, {
      values: VALUES,
    });
    expect(saved.status).toBe(200);
    const view = (await saved.json()) as SettingsView;
    expect(view.derived.githubApp).toMatchObject({
      configured: true,
      managedByEnvironment: false,
      webhookUrl: "http://localhost:1337/api/github-integration/webhook",
    });
    // Secrets never come back; the slug is stored in lower case.
    const byKey = new Map(view.settings.map((entry) => [entry.key, entry]));
    expect(byKey.get("githubApp.privateKey")).not.toHaveProperty("value");
    expect(byKey.get("githubApp.privateKey")?.configured).toBe(true);
    expect(byKey.get("githubApp.webhookSecret")).not.toHaveProperty("value");
    expect(byKey.get("githubApp.appName")?.value).toBe("margaya-example");

    expect(await appInfo(admin.cookie)).toMatchObject({
      appConfigured: true,
      appName: "margaya-example",
    });
    expect(getGithubApp()).not.toBeNull();
  });

  it("rejects a private key that isn't one", async () => {
    const admin = await signUpWithSession(app, "admin@example.com");
    const response = await adminRequest(
      app,
      "PATCH",
      "/settings",
      admin.cookie,
      {
        values: {
          ...VALUES,
          "githubApp.privateKey":
            "http://localhost:1337/api/auth/callback/github",
        },
      },
    );
    expect(response.status).toBe(400);
    expect(getGithubApp()).toBeNull();
  });

  it("removes the App when the values are cleared", async () => {
    const admin = await signUpWithSession(app, "admin@example.com");
    await adminRequest(app, "PATCH", "/settings", admin.cookie, {
      values: VALUES,
    });
    const cleared = await adminRequest(
      app,
      "PATCH",
      "/settings",
      admin.cookie,
      {
        values: Object.fromEntries(
          Object.keys(VALUES).map((key) => [key, null]),
        ),
      },
    );
    expect(cleared.status).toBe(200);
    expect((await appInfo(admin.cookie)).appConfigured).toBe(false);
    expect(getGithubApp()).toBeNull();
  });

  it("keeps environment-managed values read-only", async () => {
    vi.stubEnv("GITHUB_APP_ID", "999");
    vi.stubEnv("GITHUB_PRIVATE_KEY", PEM);
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "env-secret");
    const admin = await signUpWithSession(app, "admin@example.com");
    const response = await adminRequest(
      app,
      "PATCH",
      "/settings",
      admin.cookie,
      { values: { "githubApp.appId": "123" } },
    );
    expect(response.status).toBe(409);
    const view = (await (
      await adminRequest(app, "GET", "/settings", admin.cookie)
    ).json()) as SettingsView;
    expect(view.derived.githubApp).toMatchObject({
      configured: true,
      managedByEnvironment: true,
    });
  });

  it("is for instance admins only", async () => {
    await signUpWithSession(app, "admin@example.com");
    const member = await signUpWithSession(app, "member@example.com");
    const response = await adminRequest(
      app,
      "PATCH",
      "/settings",
      member.cookie,
      { values: VALUES },
    );
    expect(response.status).toBe(403);
  });
});
