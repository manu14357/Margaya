import { expect, test } from "../../fixtures";
import {
  createApiKey,
  createWorld,
  expectJson,
  expectStatus,
  headerContext,
  type World,
} from "../../helpers/api-kit";
import { E2E_WEB_URL } from "../../helpers/env";
import {
  browserContextFor,
  openApp,
  UI_TIMEOUT,
} from "../../helpers/notifications";
import { covers } from "../../helpers/openapi";

// The installable app and the push settings. Real delivery needs a phone, a push
// service and a public HTTPS address, so a browser can't prove it here: the
// sending side is covered by tests/api-integration/web-push.test.ts.

type PushStatus = {
  available: boolean;
  publicKey: string | null;
  subscriptions: Array<{ id: string; endpoint: string }>;
};

const SETTINGS = "/dashboard/settings/account/notifications";
const PUSH = "/api/notification-preferences/push";

// A real key from RFC 8291's example, so validation accepts it. Nothing is ever
// delivered to this endpoint in this spec.
const DEVICE = {
  endpoint: "https://push.example.com/e2e-device",
  keys: {
    p256dh:
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
  },
};

let world: World;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Web push");
});

test.afterAll(async () => {
  await world.dispose();
});

test("the manifest makes the app installable", async ({ request }) => {
  const response = await request.get(`${E2E_WEB_URL}/site.webmanifest`);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.start_url).toBe("/dashboard");
  expect(manifest.scope).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(
    manifest.icons.filter(
      (icon: { purpose: string }) => icon.purpose === "any",
    ),
  ).toHaveLength(2);
});

test("the service worker is served and intercepts no requests", async ({
  request,
}) => {
  const response = await request.get(`${E2E_WEB_URL}/sw.js`);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("javascript");
  const source = await response.text();
  expect(source).toContain('addEventListener("push"');
  expect(source).not.toContain('addEventListener("fetch"');
});

test("the push routes need a signed-in session", async () => {
  const response = await world.anonymous.get(
    "/api/notification-preferences/push",
  );
  expect(response.ok()).toBe(false);
});

test(
  "the push routes save and remove a device for the signed-in person only",
  covers("getPushStatus", "savePushSubscription", "deletePushSubscription"),
  async () => {
    const admin = world.as("admin");
    const viewer = world.as("viewer");
    // Endpoints are unique across accounts, so this one is for this test alone.
    const device = {
      ...DEVICE,
      endpoint: `https://push.example.com/e2e-api-${world.users.admin.id}`,
    };
    const subscriptions = `${PUSH}/subscriptions`;

    const before = await expectJson<PushStatus>(await admin.get(PUSH));
    expect(before.available).toBe(true);
    expect(before.publicKey).toBeTruthy();
    expect(before.subscriptions).toEqual([]);

    const saved = await expectJson<PushStatus>(
      await admin.put(subscriptions, { data: device }),
    );
    expect(saved.subscriptions.map((entry) => entry.endpoint)).toEqual([
      device.endpoint,
    ]);
    expect(JSON.stringify(saved)).not.toContain(device.keys.auth);
    expect(JSON.stringify(saved)).not.toContain(device.keys.p256dh);
    const again = await expectJson<PushStatus>(
      await admin.put(subscriptions, { data: device }),
    );
    expect(again.subscriptions).toHaveLength(1);

    // Someone else can't remove it, but the device can change hands.
    await expectStatus(
      await viewer.delete(`${subscriptions}/${saved.subscriptions[0]?.id}`),
      404,
    );
    const moved = await expectJson<PushStatus>(
      await viewer.put(subscriptions, { data: device }),
    );
    expect(moved.subscriptions.map((entry) => entry.endpoint)).toEqual([
      device.endpoint,
    ]);
    const left = await expectJson<PushStatus>(await admin.get(PUSH));
    expect(left.subscriptions).toEqual([]);

    const removed = await expectJson<PushStatus>(
      await viewer.delete(`${subscriptions}/${moved.subscriptions[0]?.id}`),
    );
    expect(removed.subscriptions).toEqual([]);
    await expectStatus(
      await viewer.delete(`${subscriptions}/${moved.subscriptions[0]?.id}`),
      404,
    );

    await expectStatus(
      await viewer.put(subscriptions, {
        data: { ...device, endpoint: "http://push.example.com/not-https" },
      }),
      400,
    );
    await expectStatus(
      await viewer.put(subscriptions, {
        data: {
          endpoint: device.endpoint,
          keys: { p256dh: "not-a-key", auth: "not-a-secret" },
        },
      }),
      400,
    );

    // An API key doesn't stand in for a session here.
    const key = await createApiKey(world.as("owner"));
    const viaKey = await headerContext({ "x-api-key": key.key });
    try {
      await expectStatus(await viaKey.get(PUSH), 403);
    } finally {
      await viaKey.dispose();
    }
  },
);

test("the settings page shows the push card and its current state", async ({
  browser,
}) => {
  const status = await expectJson<PushStatus>(
    await world.as("member").get("/api/notification-preferences/push"),
  );
  const context = await browserContextFor(browser, world.users.member);
  const page = await context.newPage();
  try {
    await openApp(page, SETTINGS);
    const card = page.locator('[data-channel="push"]');
    await expect(card).toBeVisible({ timeout: UI_TIMEOUT });
    const toggle = card.getByRole("switch", { name: "On this device" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    if (!status.available) {
      await expect(card).toContainText("isn't set up on this server");
    }
  } finally {
    await context.close();
  }
});

test("a device can be saved and removed, with its keys never returned", async ({
  browser,
}) => {
  const member = world.as("member");
  const before = await expectJson<PushStatus>(
    await member.get("/api/notification-preferences/push"),
  );
  // Run with VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY set on the API to cover this.
  test.skip(!before.available, "push is not set up on the e2e API");

  const saved = await member.put(
    "/api/notification-preferences/push/subscriptions",
    { data: DEVICE },
  );
  const status = await expectJson<PushStatus>(saved);
  expect(JSON.stringify(status)).not.toContain(DEVICE.keys.auth);
  expect(status.subscriptions).toHaveLength(1);

  const context = await browserContextFor(browser, world.users.member);
  const page = await context.newPage();
  try {
    await openApp(page, SETTINGS);
    const card = page.locator('[data-channel="push"]');
    await expect(card.getByText("Your other devices")).toBeVisible({
      timeout: UI_TIMEOUT,
    });
    await card.getByRole("button", { name: /^Remove / }).click();
    await expect(card.getByText("Your other devices")).toBeHidden({
      timeout: UI_TIMEOUT,
    });
  } finally {
    await context.close();
  }

  const after = await expectJson<PushStatus>(
    await member.get("/api/notification-preferences/push"),
  );
  expect(after.subscriptions).toHaveLength(0);
});
