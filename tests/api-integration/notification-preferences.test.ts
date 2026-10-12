import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { SECRET_KEY_MISSING_MESSAGE } from "../../apps/api/src/notification-preferences/secrets";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

type Preferences = {
  webhookEnabled: boolean;
  webhookConfigured: boolean;
  webhookUrl: string | null;
  webhookSecretConfigured: boolean;
  maskedWebhookSecret: string | null;
  ntfyServerUrl: string | null;
  ntfyTopic: string | null;
  taskCommentEnabled: boolean;
};

const HOOK = "http://127.0.0.1/hook";

async function preferencesApi() {
  const { user } = await createWorkspaceMember();
  mockAuthenticatedSession(user);
  const { app } = createApp();
  const put = (body: Record<string, unknown>) =>
    app.request("/api/notification-preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const get = () => app.request("/api/notification-preferences");
  return { user, put, get };
}

async function json<T>(response: Response | Promise<Response>) {
  const resolved = await response;
  expect(resolved.status, await resolved.clone().text()).toBe(200);
  return (await resolved.json()) as T;
}

describe("API integration: notification preferences", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    vi.stubEnv("MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 503 with what to set when a secret can't be encrypted, and stores nothing", async () => {
    const { put, get, user } = await preferencesApi();

    const response = await put({
      webhookEnabled: true,
      webhookUrl: HOOK,
      webhookSecret: "signing-secret",
    });
    expect(response.status).toBe(503);
    const message = await response.text();
    expect(message).toBe(SECRET_KEY_MISSING_MESSAGE);
    expect(message).toContain("NOTIFICATION_SECRET_ENCRYPTION_KEY");
    expect(
      await db
        .select()
        .from(schema.userNotificationPreferenceTable)
        .where(eq(schema.userNotificationPreferenceTable.userId, user.id)),
    ).toEqual([]);

    // Everything that needs no secret keeps working.
    const saved = await json<Preferences>(
      put({
        webhookEnabled: true,
        webhookUrl: HOOK,
        taskCommentEnabled: false,
      }),
    );
    expect(saved).toMatchObject({
      webhookEnabled: true,
      webhookUrl: HOOK,
      webhookSecretConfigured: false,
      taskCommentEnabled: false,
    });
    await json<Preferences>(get());
  });

  it("stores a secret encrypted with the key, and still loads after the key is removed", async () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "a-long-random-test-key");
    const { put, get, user } = await preferencesApi();

    const saved = await json<Preferences>(
      put({
        webhookEnabled: true,
        webhookUrl: HOOK,
        webhookSecret: "s3cret-value",
      }),
    );
    expect(saved.webhookSecretConfigured).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("s3cret-value");
    const [row] = await db
      .select({ secret: schema.userNotificationPreferenceTable.webhookSecret })
      .from(schema.userNotificationPreferenceTable)
      .where(eq(schema.userNotificationPreferenceTable.userId, user.id));
    expect(row?.secret).toMatch(/^enc:v1:/);

    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "");
    const loaded = await json<Preferences>(get());
    expect(loaded).toMatchObject({
      webhookSecretConfigured: true,
      maskedWebhookSecret: null,
    });
    const toggled = await json<Preferences>(put({ taskCommentEnabled: false }));
    expect(toggled.webhookSecretConfigured).toBe(true);
  });

  it("clears a webhook URL sent as null or an empty string", async () => {
    const { put } = await preferencesApi();

    await json(put({ webhookEnabled: false, webhookUrl: HOOK }));
    const viaNull = await json<Preferences>(put({ webhookUrl: null }));
    expect(viaNull).toMatchObject({
      webhookConfigured: false,
      webhookUrl: null,
    });

    await json(put({ webhookUrl: HOOK }));
    const viaEmpty = await json<Preferences>(
      put({ webhookEnabled: false, webhookUrl: "" }),
    );
    expect(viaEmpty).toMatchObject({
      webhookConfigured: false,
      webhookUrl: null,
    });

    // Omitting the field still keeps the stored URL.
    await json(put({ webhookUrl: HOOK }));
    expect(
      (await json<Preferences>(put({ taskCommentEnabled: true }))).webhookUrl,
    ).toBe(HOOK);
  });

  it("keeps an enabled webhook from losing its URL", async () => {
    const { put } = await preferencesApi();

    await json(put({ webhookEnabled: true, webhookUrl: HOOK }));
    const response = await put({ webhookUrl: null });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Webhook notifications require an endpoint URL",
    );
  });

  it("clears ntfy fields of a disabled channel", async () => {
    const { put } = await preferencesApi();

    await json(
      put({ ntfyEnabled: false, ntfyServerUrl: HOOK, ntfyTopic: "alerts" }),
    );
    const cleared = await json<Preferences>(
      put({ ntfyServerUrl: null, ntfyTopic: "" }),
    );

    expect(cleared).toMatchObject({ ntfyServerUrl: null, ntfyTopic: null });
  });

  it("disconnects Gotify and a webhook with the settings page's payloads", async () => {
    vi.stubEnv("NOTIFICATION_SECRET_ENCRYPTION_KEY", "a-long-random-test-key");
    const { put } = await preferencesApi();
    await json(
      put({
        gotifyEnabled: true,
        gotifyServerUrl: HOOK,
        gotifyToken: "gotify-app-token",
        webhookEnabled: true,
        webhookUrl: HOOK,
        webhookSecret: "signing-secret",
      }),
    );

    await json(
      put({ gotifyEnabled: false, gotifyServerUrl: null, gotifyToken: null }),
    );
    const after = await json<
      Preferences & { gotifyConfigured: boolean; gotifyServerUrl: null }
    >(put({ webhookEnabled: false, webhookUrl: null, webhookSecret: null }));

    expect(after).toMatchObject({
      gotifyConfigured: false,
      gotifyServerUrl: null,
      webhookConfigured: false,
      webhookUrl: null,
      webhookSecretConfigured: false,
    });
  });
});
