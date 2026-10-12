import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  adminRequest,
  resetInstanceState,
  signUpWithSession,
} from "./helpers/instance-admin";

type App = ReturnType<typeof createApp>["app"];
type SettingEntry = {
  key: string;
  value?: unknown;
  source: string;
  locked: boolean;
  envVar: string | null;
};

const KEY = "general.publicLanding";

let app: App;
let admin: Awaited<ReturnType<typeof signUpWithSession>>;
let member: Awaited<ReturnType<typeof signUpWithSession>>;

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  vi.stubEnv("MARGAYA_PUBLIC_LANDING", "");
  app = createApp().app;
  admin = await signUpWithSession(app, "admin@example.com");
  member = await signUpWithSession(app, "member@example.com");
});

afterEach(() => vi.unstubAllEnvs());

async function publicLandingEnabled() {
  const response = await app.request("/api/config");
  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  return body.publicLandingEnabled;
}

async function entry(): Promise<SettingEntry> {
  const response = await adminRequest(app, "GET", "/settings", admin.cookie);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { settings: SettingEntry[] };
  const found = body.settings.find((setting) => setting.key === KEY);
  if (!found) throw new Error(`Missing ${KEY}`);
  return found;
}

function patch(value: unknown, cookie = admin.cookie) {
  return adminRequest(app, "PATCH", "/settings", cookie, {
    values: { [KEY]: value },
  });
}

describe("public landing setting", () => {
  it("is on by default and exposed through the public config", async () => {
    expect(await publicLandingEnabled()).toBe(true);
    expect(await entry()).toMatchObject({
      value: true,
      source: "default",
      locked: false,
      envVar: null,
    });
  });

  it("can be switched off and back to the default from the admin panel", async () => {
    const off = await patch(false);
    expect(off.status).toBe(200);
    expect(await entry()).toMatchObject({ value: false, source: "database" });
    expect(await publicLandingEnabled()).toBe(false);

    expect((await patch(null)).status).toBe(200);
    expect(await entry()).toMatchObject({ value: true, source: "default" });
    expect(await publicLandingEnabled()).toBe(true);
  });

  it("refuses non-boolean values and non-admins", async () => {
    expect((await patch("no")).status).toBe(400);
    expect((await patch(false, member.cookie)).status).toBe(403);
    expect(await publicLandingEnabled()).toBe(true);
  });

  it("follows MARGAYA_PUBLIC_LANDING and locks the setting", async () => {
    await patch(false);
    vi.stubEnv("MARGAYA_PUBLIC_LANDING", "true");
    expect(await publicLandingEnabled()).toBe(true);
    expect(await entry()).toMatchObject({
      value: true,
      source: "environment",
      locked: true,
      envVar: "MARGAYA_PUBLIC_LANDING",
    });
    const refused = await patch(false);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toBe(
      `${KEY} is set by MARGAYA_PUBLIC_LANDING. Remove the variable and restart to manage it here.`,
    );

    vi.stubEnv("MARGAYA_PUBLIC_LANDING", "false");
    expect(await publicLandingEnabled()).toBe(false);
    expect(await entry()).toMatchObject({
      value: false,
      source: "environment",
    });
  });
});
