import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { E2E_WEB_URL } from "../../../helpers/env";
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
  escapeRegExp,
  fillRichText,
  openTaskPage,
  toast,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";
import { SEED_USERS } from "../../../seed/data";

// Comment threads: replies live inside their top-level comment's card, with
// a compact composer, a Reply action in the card's footer and "⋯" menu,
// and long threads folded to their newest three replies.

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 300_000 });
test.use({ navigationTimeout: 120_000 });

type Comment = { id: string; content: string; parentId: string | null };

const OWNER = SEED_USERS.owner.name;

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Threads") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

async function postComment(
  api: APIRequestContext,
  taskId: string,
  content: string,
  parentId?: string,
): Promise<Comment> {
  return readJson<Comment>(
    await api.post(`/api/comment/${taskId}`, {
      data: parentId ? { content, parentId } : { content },
    }),
    parentId ? "create reply" : "create comment",
  );
}

async function listComments(
  api: APIRequestContext,
  taskId: string,
): Promise<Comment[]> {
  return readJson<Comment[]>(
    await api.get(`/api/comment/${taskId}`),
    "list comments",
  );
}

/** The stored comment whose text is `text`, once it exists. */
async function findComment(
  api: APIRequestContext,
  taskId: string,
  text: string,
): Promise<Comment> {
  let found: Comment | undefined;
  await expect
    .poll(async () => {
      found = (await listComments(api, taskId)).find((comment) =>
        comment.content.includes(text),
      );
      return found?.id ?? null;
    })
    .not.toBeNull();
  return found as Comment;
}

/**
 * A comment's card or reply row. Both carry the `comment-<id>` anchor that
 * copied links point at; cards have no other accessible handle.
 */
function commentById(page: Page, id: string): Locator {
  return page.locator(`[id="comment-${id}"]`);
}

/** The reply list inside a top-level comment's card. */
function repliesOf(card: Locator): Locator {
  return card.getByRole("list", { name: "Replies" });
}

/** The editable area of an open reply composer (named "Reply to …"). */
function replyEditor(page: Page, authorName: string): Locator {
  return page
    .getByRole("region", { name: `Reply to ${authorName}`, exact: true })
    .locator("[contenteditable='true']");
}

/** Open a reply row's "⋯" menu; reply actions only show on hover. */
async function openReplyMenu(page: Page, reply: Locator): Promise<void> {
  await reply.hover();
  await reply.getByRole("button", { name: "More comment actions" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

async function openInbox(page: Page, workspaceId: string) {
  await page.goto(`/dashboard/workspace/${workspaceId}/inbox`);
  await expect(
    page.getByRole("listbox", { name: "Notifications" }),
  ).toBeVisible({ timeout: 60_000 });
}

test("a reply sent from the card's composer shows in its thread, live for a watcher who is notified", async ({
  page,
  api,
  pageAs,
  seed,
}) => {
  // Mia is assigned, so she watches the task and hears about its comments.
  const task: TestTask = await createTask(api, project.id, {
    title: uniqueName("Thread target"),
    assigneeIds: [seed.users.member.id],
  });
  const path = taskPagePath(project.id, task.id);

  // Mia keeps the task open in her own browser.
  const member = await pageAs("member");
  await openTaskPage(member, path);

  await openTaskPage(page, path);
  const parentText = uniqueName("Parent comment");
  const composer = page
    .getByRole("region", { name: "Comment editor" })
    .last()
    .locator("[contenteditable='true']");
  await composer.click();
  await page.keyboard.type(parentText);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(toast(page, "Comment added")).toBeVisible();
  const parent = await findComment(api, task.id, parentText);
  const card = commentById(page, parent.id);
  await expect(card).toContainText(parentText);

  // Reply moves focus into the thread's editor, so typing stays text: none
  // of the letters below may trigger a page shortcut ("g h" goes Home,
  // "n i" opens the inbox, "p" and "v" start project and view chords).
  const replyButton = card.getByRole("button", {
    name: `Reply to ${OWNER}`,
    exact: true,
  });
  await replyButton.click();
  const editor = replyEditor(page, OWNER);
  await expect(editor).toBeFocused();
  const urlBefore = page.url();
  const replyText = `ghost ninja pvg ${Date.now().toString(36)}`;
  await page.keyboard.type(replyText);
  await expect(editor).toHaveText(replyText);
  expect(page.url()).toBe(urlBefore);

  // Ctrl/Cmd+Enter sends; the reply joins the parent's card.
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(toast(page, "Reply added")).toBeVisible();
  const reply = await findComment(api, task.id, replyText);
  expect(reply.parentId).toBe(parent.id);
  await expect(
    repliesOf(card).locator(`[id="comment-${reply.id}"]`),
  ).toContainText(replyText);
  // Sending closed the composer and handed focus back to Reply.
  await expect(editor).toHaveCount(0);
  await expect(replyButton).toBeFocused();

  // Esc closes a reopened composer and returns focus to Reply too.
  await replyButton.click();
  await expect(editor).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(replyButton).toBeFocused();
  // With replies, a collapsed "Write a reply..." row stays under them.
  await expect(
    card.getByRole("button", { name: "Write a reply...", exact: true }),
  ).toBeVisible();

  // Mia sees the reply inside the card without reloading.
  const memberCard = commentById(member, parent.id);
  await expect(memberCard).toContainText(parentText, { timeout: 30_000 });
  await expect(
    repliesOf(memberCard).locator(`[id="comment-${reply.id}"]`),
  ).toContainText(replyText, { timeout: 30_000 });

  // ... and her inbox says Olivia replied to a comment.
  await openInbox(member, seed.workspace.id);
  const row = member
    .getByRole("listbox", { name: "Notifications" })
    .getByRole("option", { name: new RegExp(escapeRegExp(task.title)) })
    .filter({ hasText: "replied to a comment" });
  await expect(async () => {
    if (!(await row.isVisible())) {
      await member.getByRole("button", { name: "Refresh" }).click();
    }
    await expect(row).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
  await expect(row).toContainText(OWNER);
});

test("the author edits and deletes a reply from its menu", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Thread edits"),
  });
  const parent = await postComment(api, task.id, "Where do we ship from?");
  const reply = await postComment(
    api,
    task.id,
    "From the main branch",
    parent.id,
  );

  await openTaskPage(page, taskPagePath(project.id, task.id));
  const card = commentById(page, parent.id);
  const row = commentById(page, reply.id);
  await expect(
    repliesOf(card).locator(`[id="comment-${reply.id}"]`),
  ).toHaveText(/From the main branch/);

  // The menu offers the author Edit, Copy link and Delete (no nested Reply).
  await openReplyMenu(page, row);
  await expect(page.getByRole("menuitem", { name: "Copy link" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reply" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Edit comment" }).click();

  const editor = row.locator("[contenteditable='true']");
  await expect(editor).toBeFocused();
  await fillRichText(editor, "From the release branch");
  await row.getByRole("button", { name: "Save", exact: true }).click();
  await expect(toast(page, "Comment updated")).toBeVisible();
  await expect(row).toContainText("From the release branch");
  await expect(row.locator("[contenteditable='true']")).toHaveCount(0);
  await expect
    .poll(async () =>
      (await listComments(api, task.id)).find((c) => c.id === reply.id),
    )
    .toMatchObject({
      content: expect.stringContaining("release branch"),
      parentId: parent.id,
    });

  // Deleting the reply leaves the parent and its card in place.
  await openReplyMenu(page, row);
  await page.getByRole("menuitem", { name: "Delete comment" }).click();
  await expect(row).toHaveCount(0);
  await expect(card).toContainText("Where do we ship from?");
  await expect(repliesOf(card)).toHaveCount(0);
  await expect
    .poll(async () => (await listComments(api, task.id)).map((c) => c.id))
    .toEqual([parent.id]);
});

test("a long thread folds to its newest replies, and a copied link opens the hidden one", async ({
  page,
  api,
  pageAs,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Long thread"),
  });
  const parent = await postComment(api, task.id, "Pick a launch date");
  const replies: Comment[] = [];
  for (const text of ["Monday", "Tuesday", "Wednesday", "Thursday"]) {
    replies.push(await postComment(api, task.id, `${text} works`, parent.id));
  }
  const [oldest] = replies as [Comment, ...Comment[]];

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: E2E_WEB_URL,
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));
  const card = commentById(page, parent.id);
  const list = repliesOf(card);

  // Three newest replies show; the oldest folds behind "Show 1 more reply".
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list).toContainText("Thursday works");
  await expect(list).not.toContainText("Monday works");
  const toggle = card.getByRole("button", { name: "Show 1 more reply" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(list.getByRole("listitem").first()).toContainText(
    "Monday works",
  );
  const fewer = card.getByRole("button", { name: "Show fewer replies" });
  await expect(fewer).toHaveAttribute("aria-expanded", "true");
  await fewer.click();
  await expect(list.getByRole("listitem")).toHaveCount(3);

  // Copy link on the oldest reply copies the task page with its anchor.
  await toggle.click();
  await openReplyMenu(page, commentById(page, oldest.id));
  await page.getByRole("menuitem", { name: "Copy link" }).click();
  await expect(toast(page, "Comment link copied")).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(
    `${E2E_WEB_URL}${taskPagePath(project.id, task.id)}#comment-${oldest.id}`,
  );

  // Opening the link elsewhere unfolds the thread and scrolls to the reply.
  const reader = await pageAs("member");
  await reader.goto(link);
  const target = commentById(reader, oldest.id);
  await expect(target).toContainText("Monday works", { timeout: 60_000 });
  await expect(target).toBeInViewport();
  await expect(
    commentById(reader, parent.id).getByRole("button", {
      name: "Show fewer replies",
    }),
  ).toHaveAttribute("aria-expanded", "true");
});
