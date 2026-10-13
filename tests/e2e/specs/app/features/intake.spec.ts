import type { APIRequestContext, Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { readJson } from "../../../helpers/http";
import { waitForNotification } from "../../../helpers/notifications";
import {
  createProject,
  createTask,
  deleteProject,
  projectSettingsPath,
  type TestProject,
} from "../../../helpers/task-data";
import { escapeRegExp } from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";
import {
  expect,
  projectPath,
  setFeatures,
  toastText,
  workspaceSectionPath,
} from "./_support";

// Intake: requests from viewers and members wait for review; admins accept,
// decline, snooze or mark them as duplicates, and requesters are notified.

test.describe.configure({ timeout: 240_000 });
test.use({ navigationTimeout: 120_000 });

type IntakeItem = {
  id: string;
  taskId: string;
  status: string;
  task: { key?: string; title: string };
};

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Intake") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

async function submitRequest(
  ctx: APIRequestContext,
  projectId: string,
  title: string,
): Promise<IntakeItem> {
  return readJson<IntakeItem>(
    await ctx.post(`/api/intake/project/${projectId}`, {
      data: { title, description: "Please take a look", priority: "medium" },
    }),
    `submit request ${title}`,
  );
}

async function pendingCount(api: APIRequestContext, projectId: string) {
  const summary = await readJson<{ pending: number }>(
    await api.get(`/api/intake/project/${projectId}/summary`),
    "intake summary",
  );
  return summary.pending;
}

async function openIntake(page: Page, projectId: string) {
  await page.goto(projectPath(projectId, "intake"));
  await expect(
    page
      .getByRole("list", { name: "Requests" })
      .or(page.getByText("No requests yet"))
      .or(page.getByText("You're all caught up"))
      .or(page.getByText("You haven't submitted any requests"))
      .first(),
  ).toBeVisible({ timeout: 90_000 });
}

/** A request in the list (its button holds the key, title and submitter). */
function requestRow(page: Page, title: string) {
  return page
    .getByRole("list", { name: "Requests" })
    .getByRole("button", { name: new RegExp(escapeRegExp(title)) });
}

/** The count on the context panel's Intake entry (shown only there). */
function pendingBadge(page: Page, count: number) {
  return page
    .getByRole("complementary", { name: "Section navigation" })
    .getByRole("img", {
      name: `${count} requests waiting for review`,
    });
}

test("intake turns on, a viewer submits a request and an admin accepts it", async ({
  page,
  api,
  apiAs,
  pageAs,
}) => {
  // Turn Intake on in the project's Features.
  await page.goto(projectSettingsPath(project.id, "features"));
  const toggle = page.getByRole("switch", { name: "Intake", exact: true });
  await expect(toggle).not.toBeChecked({ timeout: 60_000 });
  await toggle.click();
  await expect(toastText(page, "Intake turned on")).toBeVisible();

  // A viewer files a request from the Intake section.
  const viewer = await pageAs("viewer");
  await openIntake(viewer, project.id);
  await viewer.getByRole("button", { name: "New request" }).first().click();
  const dialog = viewer.getByRole("dialog", { name: "New request" });
  const title = uniqueName("Need a dark mode");
  await dialog.getByRole("textbox", { name: "What do you need?" }).fill(title);
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expect(toastText(viewer, "Request submitted")).toBeVisible();
  await expect(requestRow(viewer, title)).toBeVisible();
  // Viewers cannot triage.
  await expect(
    viewer.getByRole("img", { name: /requests waiting for review/ }),
  ).toHaveCount(0);

  await expect.poll(() => pendingCount(api, project.id)).toBe(1);
  const item = (
    await readJson<{ items: IntakeItem[] }>(
      await api.get(`/api/intake/project/${project.id}`),
      "list intake",
    )
  ).items.find((entry) => entry.task.title === title);
  expect(item, "the request is in the queue").toBeTruthy();

  // The admin sees the pending badge and accepts it.
  const admin = await pageAs("admin");
  await openIntake(admin, project.id);
  await expect(pendingBadge(admin, 1)).toBeVisible();
  await requestRow(admin, title).click();
  await admin.getByRole("button", { name: "Accept", exact: true }).click();
  const accept = admin.getByRole("dialog", { name: /^Accept / });
  await expect(
    accept.getByText("Move this request to the board as a task."),
  ).toBeVisible();
  await accept.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(toastText(admin, /accepted into/)).toBeVisible();
  await expect(pendingBadge(admin, 1)).toHaveCount(0);
  await expect.poll(() => pendingCount(api, project.id)).toBe(0);

  // The requester hears about it.
  const viewerApi = await apiAs("viewer");
  const notification = await waitForNotification(
    viewerApi,
    (entry) =>
      entry.type === "intake_accepted" &&
      (entry.eventData as { intakeItemId?: string } | null)?.intakeItemId ===
        item?.id,
    "the accepted notification",
  );
  expect(notification.eventData).toMatchObject({ taskTitle: title });
});

test("an admin declines, snoozes and marks requests as duplicates, and the requester is told", async ({
  api,
  apiAs,
  pageAs,
}) => {
  await setFeatures(api, project.id, { intakeEnabled: true });
  const existing = await createTask(api, project.id, {
    title: uniqueName("Existing work"),
  });
  const memberApi = await apiAs("member");
  const declineTitle = uniqueName("Decline me");
  const snoozeTitle = uniqueName("Snooze me");
  const duplicateTitle = uniqueName("Duplicate me");
  const declined = await submitRequest(memberApi, project.id, declineTitle);
  await submitRequest(memberApi, project.id, snoozeTitle);
  const duplicate = await submitRequest(memberApi, project.id, duplicateTitle);

  const admin = await pageAs("admin");
  await openIntake(admin, project.id);
  await expect(pendingBadge(admin, 3)).toBeVisible();

  // Decline with a reason.
  await requestRow(admin, declineTitle).click();
  await admin.getByRole("button", { name: "Decline", exact: true }).click();
  const decline = admin.getByRole("alertdialog", { name: /^Decline / });
  await decline.getByLabel("Reason (optional)").fill("Out of scope");
  await decline.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(toastText(admin, "Request declined")).toBeVisible();
  await expect(pendingBadge(admin, 2)).toBeVisible();

  // Snooze until tomorrow.
  await requestRow(admin, snoozeTitle).click();
  await admin.getByRole("button", { name: "Snooze", exact: true }).click();
  await admin.getByRole("button", { name: /^Tomorrow/ }).click();
  await expect(toastText(admin, /^Snoozed until /)).toBeVisible();
  await expect(pendingBadge(admin, 1)).toBeVisible();

  // Mark the last one as a duplicate of an existing task.
  await requestRow(admin, duplicateTitle).click();
  await admin.getByRole("button", { name: "More actions" }).click();
  await admin.getByRole("menuitem", { name: "Mark as duplicate" }).click();
  await admin
    .getByPlaceholder("Search tasks by key or title")
    .fill(existing.title.split(" ")[0] ?? existing.title);
  await admin
    .getByRole("option", { name: new RegExp(escapeRegExp(existing.title)) })
    .click();
  await expect(toastText(admin, /^Marked as a duplicate of /)).toBeVisible();
  await expect(
    admin.getByRole("img", { name: /requests waiting for review/ }),
  ).toHaveCount(0);
  await expect.poll(() => pendingCount(api, project.id)).toBe(0);

  // Closed requests are listed under Closed.
  await admin.getByRole("tab", { name: "Closed" }).click();
  await expect(requestRow(admin, declineTitle)).toBeVisible();
  await expect(requestRow(admin, duplicateTitle)).toBeVisible();
  await expect(requestRow(admin, snoozeTitle)).toHaveCount(0);

  // The requester is notified of both outcomes, with the reason.
  const declinedNote = await waitForNotification(
    memberApi,
    (entry) =>
      entry.type === "intake_declined" &&
      (entry.eventData as { intakeItemId?: string } | null)?.intakeItemId ===
        declined.id,
    "the declined notification",
  );
  expect(declinedNote.eventData).toMatchObject({ note: "Out of scope" });
  const duplicateNote = await waitForNotification(
    memberApi,
    (entry) =>
      entry.type === "intake_duplicate" &&
      (entry.eventData as { intakeItemId?: string } | null)?.intakeItemId ===
        duplicate.id,
    "the duplicate notification",
  );
  expect(duplicateNote.eventData).toMatchObject({
    duplicateTaskId: existing.id,
  });

  // And sees them in the inbox.
  const member = await pageAs("member");
  await member.goto(workspaceSectionPath("inbox"));
  const inbox = member.getByRole("listbox", { name: "Notifications" });
  const row = inbox
    .getByRole("option", { name: new RegExp(escapeRegExp(declineTitle)) })
    .filter({ hasText: "declined your request" });
  await expect(async () => {
    if (!(await row.isVisible())) {
      await member.getByRole("button", { name: "Refresh" }).click();
    }
    await expect(row).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
});

test("the triage queue works from the keyboard", async ({ page, api }) => {
  await setFeatures(api, project.id, { intakeEnabled: true });
  const firstTitle = uniqueName("Keyboard first");
  const secondTitle = uniqueName("Keyboard second");
  await submitRequest(api, project.id, firstTitle);
  await submitRequest(api, project.id, secondTitle);

  await openIntake(page, project.id);
  await expect(page.getByText(/Open task/).first()).toBeVisible();

  // J moves the selection to the next request.
  await expect(requestRow(page, firstTitle)).toBeVisible();
  await expect(requestRow(page, secondTitle)).toBeVisible();
  await page
    .getByRole("list", { name: "Requests" })
    .getByRole("button")
    .first()
    .click();
  await expect(page).toHaveURL(/[?&]item=/);
  const firstItem = new URL(page.url()).searchParams.get("item");
  // The detail pane must have loaded before the queue's keys act on it.
  await expect(
    page.getByRole("button", { name: "Decline", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("j");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("item"))
    .not.toBe(firstItem);

  // S opens the snooze presets; Escape closes them.
  await expect(
    page.getByRole("button", { name: "Snooze", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("s");
  await expect(page.getByRole("button", { name: /^Tomorrow/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Tomorrow/ })).toHaveCount(0);
  await expect(page.locator('[data-slot="popover-popup"]')).toHaveCount(0);

  // D declines through the same dialog as the header's button.
  await page.keyboard.press("d");
  const decline = page.getByRole("alertdialog", { name: /^Decline / });
  await expect(decline).toBeVisible();
  await decline.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(toastText(page, "Request declined")).toBeVisible();
  await expect.poll(() => pendingCount(api, project.id)).toBe(1);
});
