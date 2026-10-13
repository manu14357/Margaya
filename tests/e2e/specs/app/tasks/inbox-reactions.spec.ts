import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { readJson } from "../../../helpers/http";
import {
  createProject,
  createTask,
  deleteProject,
  type TestProject,
  type TestTask,
  taskPagePath,
} from "../../../helpers/task-data";
import {
  closeMenus,
  escapeRegExp,
  openTaskPage,
  toast,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 300_000 });
test.use({ navigationTimeout: 120_000 });

type ReactionGroup = {
  emoji: string;
  count: number;
  users?: { id: string }[];
};
type Reactions = {
  task: ReactionGroup[];
  comments:
    | Record<string, ReactionGroup[]>
    | { commentId: string; groups: ReactionGroup[] }[];
};

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Inbox") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

async function openInbox(page: Page, workspaceId: string) {
  await page.goto(`/dashboard/workspace/${workspaceId}/inbox`);
  await expect(
    page.getByRole("listbox", { name: "Notifications" }),
  ).toBeVisible({
    timeout: 60_000,
  });
}

/** The member's notification row about `task` (titles are unique per run). */
function notificationRow(
  page: Page,
  task: TestTask,
  verb: string | RegExp,
): Locator {
  return page
    .getByRole("listbox", { name: "Notifications" })
    .getByRole("option", { name: new RegExp(escapeRegExp(task.title)) })
    .filter({ hasText: verb });
}

async function waitForRow(page: Page, row: Locator) {
  // Notifications are written by an event handler; refresh until it lands.
  await expect(async () => {
    if (!(await row.isVisible())) {
      await page.getByRole("button", { name: "Refresh" }).click();
    }
    await expect(row).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

test("an assignment reaches the member's inbox, which reads, archives and restores it", async ({
  api,
  pageAs,
  seed,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Inbox assignment"),
  });
  await api.patch(`/api/task/assignees/${task.id}`, {
    data: { add: [seed.users.member.id] },
  });

  const member = await pageAs("member");
  await openInbox(member, seed.workspace.id);
  const row = notificationRow(member, task, "assigned you");
  await waitForRow(member, row);
  await expect(row).toContainText("Olivia Owner");
  await expect(row).toContainText(`${project.slug}-${task.number}`);
  await expect(row.getByRole("button", { name: "Mark as read" })).toBeVisible();

  // Opening it shows the task and marks it read.
  await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(
    member.getByRole("button", { name: "Close preview" }),
  ).toBeVisible();
  await expect(
    member.getByRole("textbox", { name: "Click to add a title" }),
  ).toHaveValue(task.title);
  await expect(
    row.getByRole("button", { name: "Mark as unread" }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Mark as unread" }).click();
  await expect(row.getByRole("button", { name: "Mark as read" })).toBeVisible();

  // Archive, find it under Archived, move it back.
  await row.getByRole("button", { name: "Archive" }).click();
  await expect(toast(member, "Notification archived")).toBeVisible();
  await expect(row).toHaveCount(0);
  await member.getByRole("button", { name: "View", exact: true }).click();
  await member.getByRole("menuitemradio", { name: "Archived" }).click();
  // Radio items keep the menu open.
  await closeMenus(member);
  await expect(
    member.getByText("Viewing archived notifications"),
  ).toBeVisible();
  const archived = notificationRow(member, task, "assigned you");
  await expect(archived).toBeVisible();
  await archived.getByRole("button", { name: "Move to inbox" }).click();
  await expect(toast(member, "Moved back to inbox")).toBeVisible();
  await member.getByRole("button", { name: "Back to inbox" }).click();
  await expect(notificationRow(member, task, "assigned you")).toBeVisible();
});

test("a mention in a comment shows under Mentions", async ({
  page,
  api,
  pageAs,
  seed,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Mention target"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));
  const composer = page
    .getByRole("region", { name: "Comment editor" })
    .last()
    .locator("[contenteditable='true']");
  await composer.click();
  await page.keyboard.type("Could you check this ");
  await page.keyboard.type("@Mia");
  await page.getByRole("button", { name: "Mia Member" }).click();
  await expect(composer).toContainText("Mia Member");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(toast(page, "Comment added")).toBeVisible();

  const member = await pageAs("member");
  await openInbox(member, seed.workspace.id);
  await member.getByRole("tab", { name: /^Mentions/ }).click();
  const row = notificationRow(member, task, "mentioned you in a comment");
  await waitForRow(member, row);
  await expect(row).toContainText("Olivia Owner");

  // Only mentions are listed here.
  await expect(
    member
      .getByRole("listbox", { name: "Notifications" })
      .getByRole("option")
      .filter({ hasText: "assigned you" }),
  ).toHaveCount(0);
});

test("a snoozed notification leaves the inbox until it is unsnoozed", async ({
  api,
  pageAs,
  seed,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Snooze me"),
  });
  await api.patch(`/api/task/assignees/${task.id}`, {
    data: { add: [seed.users.member.id] },
  });

  const member = await pageAs("member");
  await openInbox(member, seed.workspace.id);
  const row = notificationRow(member, task, "assigned you");
  await waitForRow(member, row);

  await row.hover();
  await row.getByRole("button", { name: "Snooze" }).click();
  // Presets read "1 day" plus the moment they snooze until.
  await member.getByRole("menuitem", { name: /^1 day/ }).click();
  await expect(toast(member, /^Snoozed until /)).toBeVisible();
  await expect(row).toHaveCount(0);

  await member.getByRole("button", { name: "View", exact: true }).click();
  await member.getByRole("menuitemradio", { name: "Snoozed" }).click();
  // Radio items keep the menu open.
  await closeMenus(member);
  await expect(member.getByText("Viewing snoozed notifications")).toBeVisible();
  const snoozed = notificationRow(member, task, "assigned you");
  await expect(snoozed).toBeVisible();
  await expect(snoozed).toContainText(/Until /);

  await snoozed.hover();
  await snoozed.getByRole("button", { name: "Snooze" }).click();
  await member.getByRole("menuitem", { name: "Unsnooze" }).click();
  await expect(
    toast(member, "Notification is back in your inbox"),
  ).toBeVisible();
  await member.getByRole("button", { name: "Back to inbox" }).click();
  await expect(notificationRow(member, task, "assigned you")).toBeVisible();
});

test("the reader snoozes with S and archives with E, moving on to the next notification", async ({
  api,
  pageAs,
  seed,
}) => {
  const tasks: TestTask[] = [];
  for (const title of ["Reader first", "Reader second"]) {
    const task = await createTask(api, project.id, {
      title: uniqueName(title),
    });
    await api.patch(`/api/task/assignees/${task.id}`, {
      data: { add: [seed.users.member.id] },
    });
    tasks.push(task);
  }
  const [older, newer] = tasks as [TestTask, TestTask];

  const member = await pageAs("member");
  await openInbox(member, seed.workspace.id);
  const first = notificationRow(member, newer, "assigned you");
  await waitForRow(member, first);
  await waitForRow(member, notificationRow(member, older, "assigned you"));

  // Nothing open yet: the reading pane lists its keys.
  await expect(
    member.getByRole("definition").filter({ hasText: "Archive and move on" }),
  ).toBeVisible();

  await first.click();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(
    member.getByRole("textbox", { name: "Click to add a title" }),
  ).toHaveValue(newer.title);

  await member.keyboard.press("s");
  await expect(member.getByRole("menuitem", { name: /^1 day/ })).toBeVisible();
  await member.keyboard.press("Escape");
  await expect(member.getByRole("menuitem", { name: /^1 day/ })).toHaveCount(0);

  const archivedId = new URL(member.url()).searchParams.get("notificationId");
  expect(archivedId).toBeTruthy();
  await first.focus();
  await member.keyboard.press("e");
  await expect(toast(member, "Notification archived")).toBeVisible();
  await expect(first).toHaveCount(0);
  // The reader moved on to the neighbouring notification.
  await expect(
    member
      .getByRole("listbox", { name: "Notifications" })
      .getByRole("option", { selected: true }),
  ).toHaveCount(1);
  await expect(member).not.toHaveURL(
    new RegExp(`notificationId=${archivedId}`),
  );
});

test("reactions on a task and a comment count every member", async ({
  page,
  api,
  apiAs,
  seed,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Reacted task"),
  });
  const comment = await readJson<{ id: string }>(
    await api.post(`/api/comment/${task.id}`, {
      data: { content: "A comment worth a reaction" },
    }),
    "create comment",
  );
  const reactions = async () =>
    readJson<Reactions>(
      await api.get(`/api/reaction/task/${task.id}`),
      "list reactions",
    );

  await openTaskPage(page, taskPagePath(project.id, task.id));

  // React to the task.
  await page.getByRole("button", { name: "Add reaction" }).first().click();
  await page
    .getByRole("toolbar", { name: "Pick a reaction" })
    .getByRole("button", { name: "Thumbs up" })
    .click();
  const mine = page.getByRole("button", { name: "Remove Thumbs up reaction" });
  await expect(mine).toHaveAttribute("aria-pressed", "true");
  await expect(mine).toHaveText(/1$/);

  // Another member adds the same reaction.
  const member = await apiAs("member");
  await readJson(
    await member.put(`/api/reaction/task/${task.id}/thumbs_up`),
    "member reacts",
  );
  await page.reload();
  await expect(mine).toHaveText(/2$/);
  await expect
    .poll(async () => (await reactions()).task)
    .toEqual([expect.objectContaining({ emoji: "thumbs_up", count: 2 })]);

  // Clicking my chip takes my reaction back; Mia's stays.
  await mine.click();
  const theirs = page.getByRole("button", { name: "React with Thumbs up" });
  await expect(theirs).toHaveAttribute("aria-pressed", "false");
  await expect(theirs).toHaveText(/1$/);

  // React to the comment from its hover actions.
  const card = page
    .locator("div.group")
    .filter({ hasText: "A comment worth a reaction" })
    .last();
  await card.hover();
  await card.getByRole("button", { name: "Add reaction" }).click();
  await page
    .getByRole("toolbar", { name: "Pick a reaction" })
    .getByRole("button", { name: "Heart" })
    .click();
  await expect(
    card.getByRole("button", { name: "Remove Heart reaction" }),
  ).toHaveText(/1$/);
  await expect
    .poll(async () => JSON.stringify((await reactions()).comments))
    .toContain("heart");
  void comment;
  void seed;
});
