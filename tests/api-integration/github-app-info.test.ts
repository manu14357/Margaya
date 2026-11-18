import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import type { SettingValue } from "../../apps/api/src/instance-settings/catalog";
import { refreshInstanceSettings } from "../../apps/api/src/instance-settings/snapshot";
import { mockAuthenticatedSession } from "./helpers/auth";
import { createWorkspaceMember } from "./helpers/fixtures";
import { resetInstanceState } from "./helpers/instance-admin";

beforeEach(async () => {
  await resetInstanceState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function saveDirect(values: Record<string, SettingValue>) {
  await db
    .insert(schema.instanceSettingTable)
    .values(Object.entries(values).map(([key, value]) => ({ key, value })));
  await refreshInstanceSettings();
}

async function appInfo() {
  const { user } = await createWorkspaceMember();
  mockAuthenticatedSession(user);
  const response = await createApp().app.request(
    "/api/github-integration/app-info",
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    accountLinkingAvailable: boolean;
    appConfigured: boolean;
  };
}

describe("GitHub app info: account linking", () => {
  it("is unavailable while GitHub sign-in has no credentials", async () => {
    expect((await appInfo()).accountLinkingAvailable).toBe(false);
  });

  it("is available when the credentials were saved in the instance panel", async () => {
    await saveDirect({
      "oauth.github.clientId": "github-client-id",
      "oauth.github.clientSecret": "github-client-secret",
    });
    expect((await appInfo()).accountLinkingAvailable).toBe(true);
  });

  it("is unavailable when an administrator turned GitHub sign-in off", async () => {
    await saveDirect({
      "oauth.github.clientId": "github-client-id",
      "oauth.github.clientSecret": "github-client-secret",
      "oauth.github.enabled": false,
    });
    expect((await appInfo()).accountLinkingAvailable).toBe(false);
  });
});

describe("GitHub app info: repository access", () => {
  it("reports that no GitHub App is set up", async () => {
    expect((await appInfo()).appConfigured).toBe(false);
  });
});
