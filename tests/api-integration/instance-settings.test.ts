import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { SETTINGS_CATALOG } from "../../apps/api/src/instance-settings/catalog";
import { refreshInstanceSettings } from "../../apps/api/src/instance-settings/snapshot";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { createApiKey } from "./helpers/api-keys";
import {
  adminRequest,
  resetInstanceState,
  signUpWithSession,
  unlockSignUpSettings,
} from "./helpers/instance-admin";

type App = ReturnType<typeof createApp>["app"];
type Settings = {
  locked: boolean;
  settings: Array<{
    key: string;
    value?: unknown;
    source: string;
    locked: boolean;
    envVar: string | null;
    secret: boolean;
    configured: boolean;
    unreadable: boolean;
    updatedBy: { id: string; name: string } | null;
  }>;
  derived: { signInMethodsActive: number };
};

const events: Array<{ type: string; data: unknown }> = [];

beforeAll(async () => {
  await subscribeToEvent("instance.settings_updated", async (data) => {
    events.push({ type: "instance.settings_updated", data });
  });
});

let app: App;
let admin: Awaited<ReturnType<typeof signUpWithSession>>;
let member: Awaited<ReturnType<typeof signUpWithSession>>;

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  events.length = 0;
  app = createApp().app;
  admin = await signUpWithSession(app, "admin@example.com");
  member = await signUpWithSession(app, "member@example.com");
  unlockSignUpSettings();
});

afterEach(() => vi.unstubAllEnvs());

function patch(values: Record<string, unknown>, cookie = admin.cookie) {
  return adminRequest(app, "PATCH", "/settings", cookie, { values });
}

async function settingsOf(response: Response) {
  expect(response.status).toBe(200);
  const body = (await response.json()) as Settings;
  return {
    body,
    entry: (key: string) => {
      const found = body.settings.find((entry) => entry.key === key);
      if (!found) throw new Error(`Missing ${key}`);
      return found;
    },
  };
}

async function config() {
  const response = await app.request("/api/config");
  return (await response.json()) as Record<string, unknown>;
}

describe("instance admin access", () => {
  const routes: Array<[string, string, unknown?]> = [
    ["GET", "/overview"],
    ["GET", "/settings"],
    ["PATCH", "/settings", { values: { "general.instanceName": "X" } }],
    ["GET", "/workspaces"],
    ["POST", "/email/test", {}],
    ["GET", "/admins"],
    ["POST", "/admins", { email: "member@example.com" }],
    ["DELETE", "/admins/someone"],
    ["GET", "/public-boards"],
  ];

  it("refuses non-admins, API keys and anonymous callers on every route", async () => {
    const key = await createApiKey(admin.user);
    for (const [method, path, body] of routes) {
      const asMember = await adminRequest(
        app,
        method,
        path,
        member.cookie,
        body,
      );
      expect(asMember.status, `${method} ${path}`).toBe(403);
      expect(await asMember.text()).toBe("Only instance admins can do this");

      const asKey = await adminRequest(app, method, path, key.headers, body);
      expect(asKey.status, `${method} ${path} with an API key`).toBe(403);
      expect(await asKey.text()).toBe("A user session is required");

      const anonymous = await adminRequest(app, method, path, {}, body);
      expect(anonymous.status, `${method} ${path} anonymous`).toBe(401);
    }
  });

  it("re-reads the role from the database", async () => {
    await db
      .update(schema.userTable)
      .set({ role: "user" })
      .where(eq(schema.userTable.id, admin.user.id));
    expect(
      (await adminRequest(app, "GET", "/settings", admin.cookie)).status,
    ).toBe(403);
  });
});

describe("reading settings", () => {
  it("returns every catalog key with its source and lock, and no secret value", async () => {
    const response = await adminRequest(app, "GET", "/settings", admin.cookie);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { body, entry } = await settingsOf(response);
    expect(body.settings.map((setting) => setting.key)).toEqual(
      SETTINGS_CATALOG.map((setting) => setting.key),
    );
    expect(entry("general.instanceName")).toMatchObject({
      value: "Margaya",
      source: "default",
      locked: false,
      envVar: null,
    });
    for (const setting of body.settings.filter((setting) => setting.secret)) {
      expect("value" in setting).toBe(false);
    }
    // An explicitly set variable locks its setting.
    vi.stubEnv("DISABLE_REGISTRATION", "true");
    const locked = await settingsOf(
      await adminRequest(app, "GET", "/settings", admin.cookie),
    );
    expect(locked.entry("auth.inviteOnly")).toMatchObject({
      value: true,
      source: "environment",
      locked: true,
      envVar: "DISABLE_REGISTRATION",
    });
  });
});

describe("precedence", () => {
  it("locks a key set by the environment", async () => {
    vi.stubEnv("DISABLE_REGISTRATION", "false");
    const response = await patch({ "auth.inviteOnly": true });
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "auth.inviteOnly is set by DISABLE_REGISTRATION. Remove the variable and restart to manage it here.",
    );
  });

  it("applies a saved value at once and reverts to the default with null", async () => {
    const { entry } = await settingsOf(
      await patch({
        "general.instanceName": "  Acme  ",
        "auth.inviteOnly": true,
      }),
    );
    expect(entry("general.instanceName")).toMatchObject({
      value: "Acme",
      source: "database",
      updatedBy: { id: admin.user.id, name: "admin" },
    });
    expect(await config()).toMatchObject({
      instanceName: "Acme",
      disableRegistration: true,
    });

    await settingsOf(
      await patch({ "general.instanceName": null, "auth.inviteOnly": null }),
    );
    expect(await config()).toMatchObject({
      instanceName: "Margaya",
      disableRegistration: false,
    });
    expect(await db.select().from(schema.instanceSettingTable)).toHaveLength(0);
  });

  it("ignores saved values under the global lock and refuses writes", async () => {
    await settingsOf(await patch({ "auth.inviteOnly": true }));
    vi.stubEnv("MARGAYA_LOCK_INSTANCE_SETTINGS", "true");
    expect((await config()).disableRegistration).toBe(false);
    const { body, entry } = await settingsOf(
      await adminRequest(app, "GET", "/settings", admin.cookie),
    );
    expect(body.locked).toBe(true);
    expect(entry("auth.inviteOnly")).toMatchObject({
      value: false,
      locked: true,
      source: "default",
    });
    const refused = await patch({ "general.instanceName": "Acme" });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toBe(
      "Instance settings are managed with environment variables on this server",
    );
  });

  it("locks a credential group but not its enabled switch", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-id");
    expect((await patch({ "oauth.google.clientSecret": "x" })).status).toBe(
      409,
    );
    const { entry } = await settingsOf(
      await patch({ "oauth.google.enabled": false }),
    );
    expect(entry("oauth.google.clientSecret")).toMatchObject({
      locked: true,
      envVar: "GOOGLE_CLIENT_ID",
    });
    expect(entry("oauth.google.enabled")).toMatchObject({
      value: false,
      locked: false,
    });
  });
});

describe("secrets", () => {
  it("stores them sealed and never returns them", async () => {
    const response = await patch({
      "smtp.host": "smtp.example.test",
      "smtp.from": "Margaya <no-reply@example.test>",
      "smtp.password": "hunter2-smtp",
    });
    const text = await response.clone().text();
    expect(text).not.toContain("hunter2-smtp");
    const { entry } = await settingsOf(response);
    expect(entry("smtp.password")).toMatchObject({
      configured: true,
      unreadable: false,
      source: "database",
    });
    expect("value" in entry("smtp.password")).toBe(false);

    const [row] = await db
      .select()
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.key, "smtp.password"));
    expect(row?.value).toBeNull();
    expect(row?.secret?.startsWith("sbx:v1:")).toBe(true);
    expect(row?.secret).not.toContain("hunter2");
    expect((await config()).hasSmtp).toBe(true);

    const reread = await (
      await adminRequest(app, "GET", "/settings", admin.cookie)
    ).text();
    expect(reread).not.toContain("hunter2-smtp");
  });

  it("reads as unreadable after the key root changes", async () => {
    await settingsOf(await patch({ "smtp.password": "hunter2-smtp" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Sessions are verified by the auth instance built at startup; only the
    // stored-secret key derives from the changed value.
    vi.stubEnv("AUTH_SECRET", "another-test-secret-with-at-least-32-chars");
    const { entry } = await settingsOf(
      await adminRequest(app, "GET", "/settings", admin.cookie),
    );
    expect(entry("smtp.password")).toMatchObject({
      unreadable: true,
      configured: false,
      source: "default",
    });
    expect(warn.mock.calls.flat().join(" ")).not.toContain("hunter2");
    vi.stubEnv("AUTH_SECRET", "test-secret-with-at-least-32-chars");
    await refreshInstanceSettings();
  });

  it("asks for null instead of an empty secret", async () => {
    const response = await patch({ "smtp.password": "" });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Use null to clear smtp.password");
  });
});

describe("validation", () => {
  it.each([
    ["oauth.custom.discoveryUrl", "not a url"],
    ["smtp.port", 0],
    ["smtp.from", "Margaya"],
    ["general.instanceName", "x".repeat(81)],
  ])("rejects %s = %j", async (key, value) => {
    const response = await patch({ [key]: value });
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(
      new RegExp(`^Invalid value for ${key}: `),
    );
  });

  it("rejects unknown keys and empty or oversized bodies", async () => {
    const unknown = await patch({ "auth.nope": true });
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toBe("Unknown setting: auth.nope");
    expect((await patch({})).status).toBe(400);
    const many = Object.fromEntries(
      Array.from({ length: 41 }, (_, index) => [`k${index}`, true]),
    );
    expect((await patch(many)).status).toBe(400);
  });

  it("keeps at least one way to sign in", async () => {
    const response = await patch({ "auth.emailSignIn": false });
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("Keep at least one way to sign in");
    expect(await db.select().from(schema.instanceSettingTable)).toHaveLength(0);
  });
});

describe("events", () => {
  it("publishes key names only, and nothing for a no-op", async () => {
    await settingsOf(
      await patch({
        "general.instanceName": "Acme",
        "smtp.password": "hunter2-smtp",
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      keys: ["general.instanceName", "smtp.password"],
      userId: admin.user.id,
    });
    expect(JSON.stringify(events[0]?.data)).not.toContain("hunter2");
    expect(JSON.stringify(events[0]?.data)).not.toContain("Acme");

    await settingsOf(await patch({ "general.instanceName": "Acme" }));
    await settingsOf(await patch({ "auth.inviteOnly": null }));
    expect(events).toHaveLength(1);
  });
});
