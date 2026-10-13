import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";
import { asRole, test } from "../../../fixtures";
import { E2E_WEB_URL } from "../../../helpers/env";
import {
  createProject,
  createTask,
  deleteProject,
  type TestProject,
} from "../../../helpers/task-data";
import { uniqueName } from "../../../helpers/ui";
import type { ReceivedRequest } from "../../../helpers/webhook-sink";
import { expect, toastText } from "./_support";

// Workspace webhooks (Settings → Workspace → Webhooks): an admin registers
// the local webhook sink, and Margaya signs every delivery with
// X-Margaya-Signature-256: v1=HMAC-SHA256(secret, "<timestamp>.<body>").

test.describe.configure({ timeout: 300_000 });
test.use({ navigationTimeout: 120_000 });

const WEBHOOKS_PATH = "/dashboard/settings/workspace/webhooks";

type Envelope = {
  id: string;
  event: string;
  webhookId: string;
  data: { id?: string; title?: string };
  redelivery?: boolean;
};

function envelope(request: ReceivedRequest): Envelope | undefined {
  return request.json as Envelope | undefined;
}

/** Whether `request` carries a valid signature made with `secret`. */
function signedWith(request: ReceivedRequest, secret: string): boolean {
  const timestamp = String(request.headers["x-margaya-timestamp"] ?? "");
  const header = String(request.headers["x-margaya-signature-256"] ?? "");
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${request.body}`, "utf8")
    .digest("hex");
  return header
    .split(",")
    .map((part) => part.trim())
    .includes(`v1=${expected}`);
}

/** Copies the secret from the one-time modal, closes it and returns it. */
async function takeSecret(page: Page): Promise<string> {
  const modal = page.getByRole("dialog", { name: "Signing secret" });
  await expect(modal).toBeVisible();
  await expect(
    modal.getByText("Copy this secret now. You won't be able to see it again."),
  ).toBeVisible();
  const secret = await modal
    .getByRole("textbox", { name: "Signing secret" })
    .inputValue();
  expect(secret.length).toBeGreaterThan(16);
  await expect(
    modal.getByRole("button", { name: "Copy the secret to continue" }),
  ).toBeDisabled();
  await modal.getByRole("button", { name: "Copy", exact: true }).click();
  await modal.getByRole("button", { name: "Done" }).click();
  await expect(modal).toBeHidden();
  return secret;
}

test.describe("as an admin", () => {
  test.use(asRole("admin"));

  let project: TestProject | undefined;
  let webhookId: string | undefined;

  test.afterEach(async ({ apiAs }) => {
    const admin = await apiAs("admin");
    if (webhookId) {
      await admin.delete(`/api/webhook/${webhookId}`).catch(() => null);
    }
    if (project) await deleteProject(admin, project.id);
    project = undefined;
    webhookId = undefined;
  });

  test("a webhook is created, tested, delivers signed events, redelivers, rotates its secret, pauses and is deleted", async ({
    page,
    apiAs,
    webhookSink,
  }) => {
    const admin = await apiAs("admin");
    project = await createProject(admin, { name: uniqueName("Hooks") });
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: E2E_WEB_URL,
      });

    await page.goto(WEBHOOKS_PATH);
    await expect(page.getByRole("link", { name: "Webhooks" })).toBeVisible({
      timeout: 90_000,
    });
    await page.getByRole("button", { name: "Create webhook" }).first().click();
    const form = page.getByRole("dialog", { name: "Create webhook" });
    const name = uniqueName("Deploy notifier");
    const path = `/margaya-${Date.now().toString(36)}`;
    await form.getByLabel("Name", { exact: true }).fill(name);
    await form.getByLabel("Endpoint URL").fill(`${webhookSink.url}${path}`);
    await form.getByRole("radio", { name: /Choose events/ }).click();
    // Nothing chosen yet: Create asks for at least one event.
    await form.getByRole("button", { name: "Create", exact: true }).click();
    await expect(form.getByText("Choose at least one event")).toBeVisible();
    await form.getByRole("checkbox", { name: "Tasks", exact: true }).click();
    await expect(
      form.getByRole("checkbox", { name: "Tasks", exact: true }),
    ).toBeChecked();
    await form.getByRole("button", { name: "Create", exact: true }).click();
    await expect(toastText(page, "Webhook created")).toBeVisible();

    // The signing secret is shown once.
    let secret = await takeSecret(page);
    await expect(page).toHaveURL(/\/webhooks\/[^/?]+/);
    webhookId = page.url().split("/webhooks/")[1]?.split(/[?#]/)[0];
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(
      page.getByText("Active", { exact: true }).first(),
    ).toBeVisible();
    const stored = await (await admin.get(`/api/webhook/${webhookId}`)).text();
    expect(stored).not.toContain(secret);
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(page.getByText("Signing secret").first()).toBeVisible();
    await expect(page.getByText(secret)).toHaveCount(0);
    await page.getByRole("tab", { name: "Deliveries" }).click();

    // Send test: the toast reports the endpoint's HTTP status.
    await page.getByRole("button", { name: "Send test" }).click();
    await expect(
      toastText(page, /^Test delivered: HTTP 200 in \d+ ms$/),
    ).toBeVisible({ timeout: 30_000 });
    const ping = await webhookSink.waitForRequest(
      (request) => request.path === path,
      30_000,
    );
    expect(ping.method).toBe("POST");
    expect(signedWith(ping, secret)).toBe(true);

    // A real event is delivered, signed, and listed under Deliveries.
    const task = await createTask(admin, project.id, {
      title: uniqueName("Hooked task"),
    });
    const created = await webhookSink.waitForRequest(
      (request) =>
        request.path === path &&
        envelope(request)?.event === "task.created" &&
        envelope(request)?.data.id === task.id,
      60_000,
    );
    expect(created.headers["x-margaya-event"]).toBe("task.created");
    expect(created.headers["x-margaya-webhook-id"]).toBe(webhookId);
    expect(signedWith(created, secret)).toBe(true);
    expect(signedWith(created, `${secret}x`)).toBe(false);
    expect(envelope(created)).toMatchObject({
      webhookId,
      data: { id: task.id },
    });

    const row = page.getByRole("row").filter({ hasText: task.title }).first();
    await expect(async () => {
      if (!(await row.isVisible())) await page.reload();
      await expect(row).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await expect(row).toContainText("task.created");
    await expect(row).toContainText("Succeeded");

    // Redeliver it from the delivery sheet.
    await row.click();
    const sheet = page.getByRole("dialog", { name: "Delivery" });
    await expect(sheet.getByText("Request headers")).toBeVisible();
    await sheet.getByRole("button", { name: "Redeliver" }).click();
    await expect(toastText(page, "Redelivery queued")).toBeVisible();
    const redelivered = await webhookSink.waitForRequest(
      (request) =>
        request.path === path &&
        envelope(request)?.redelivery === true &&
        envelope(request)?.data.id === task.id,
      60_000,
    );
    expect(signedWith(redelivered, secret)).toBe(true);
    expect(envelope(redelivered)?.id).not.toBe(envelope(created)?.id);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Rotate the secret without a grace period: only the new one signs.
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Rotate secret" }).click();
    const rotate = page.getByRole("dialog", { name: "Rotate signing secret" });
    await rotate.getByRole("combobox").click();
    await page
      .getByRole("option", { name: "Don't keep it" })
      .filter({ visible: true })
      .click();
    await rotate.getByRole("button", { name: "Rotate", exact: true }).click();
    await expect(toastText(page, "Secret rotated")).toBeVisible();
    const oldSecret = secret;
    secret = await takeSecret(page);
    expect(secret).not.toBe(oldSecret);
    await expect(page.getByText(/^Rotated /)).toBeVisible();

    webhookSink.clear();
    await page.getByRole("button", { name: "Send test" }).click();
    await expect(
      toastText(page, /^Test delivered: HTTP 200 in \d+ ms$/),
    ).toBeVisible({ timeout: 30_000 });
    const rotatedPing = await webhookSink.waitForRequest(
      (request) => request.path === path,
      30_000,
    );
    expect(signedWith(rotatedPing, secret)).toBe(true);
    expect(signedWith(rotatedPing, oldSecret)).toBe(false);

    // Pause: no more deliveries.
    await page.getByRole("button", { name: "Webhook actions" }).click();
    await page.getByRole("menuitem", { name: "Pause" }).click();
    await expect(toastText(page, "Webhook paused")).toBeVisible();
    await expect(
      page.getByText("Paused", { exact: true }).first(),
    ).toBeVisible();
    const quiet = await createTask(admin, project.id, {
      title: uniqueName("Unheard task"),
    });
    await expect(
      webhookSink.waitForRequest(
        (request) => envelope(request)?.data.id === quiet.id,
        10_000,
      ),
    ).rejects.toThrow(/no matching request/);

    // Delete.
    await page.getByRole("button", { name: "Delete webhook" }).click();
    const confirm = page.getByRole("alertdialog", {
      name: "Delete this webhook?",
    });
    await confirm.getByRole("button", { name: "Delete webhook" }).click();
    await expect(toastText(page, "Webhook deleted")).toBeVisible();
    await expect(page).toHaveURL(/\/webhooks$/);
    await expect(page.getByText(name)).toHaveCount(0);
    expect((await admin.get(`/api/webhook/${webhookId}`)).status()).toBe(404);
    webhookId = undefined;
  });
});

test("a member sees no Webhooks settings", async ({ pageAs, apiAs, seed }) => {
  const member = await pageAs("member");
  await member.goto("/dashboard/settings/workspace/general");
  await expect(member.getByRole("link", { name: "Labels" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(member.getByRole("link", { name: "Webhooks" })).toHaveCount(0);

  await member.goto(WEBHOOKS_PATH);
  await expect(
    member.getByText("You don't have permission to manage webhooks."),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    member.getByRole("button", { name: "Create webhook" }),
  ).toHaveCount(0);

  const memberApi = await apiAs("member");
  const response = await memberApi.get("/api/webhook", {
    params: { workspaceId: seed.workspace.id },
  });
  expect(response.status()).toBe(403);
});
