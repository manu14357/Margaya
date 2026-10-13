import { test } from "../../../fixtures";
import { E2E_WEB_URL } from "../../../helpers/env";
import { readJson } from "../../../helpers/http";
import { waitForNotification } from "../../../helpers/notifications";
import {
  createProject,
  createTask,
  deleteProject,
  projectSettingsPath,
  type TestProject,
  taskPagePath,
} from "../../../helpers/task-data";
import { escapeRegExp, openTaskPage } from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";
import {
  createPage,
  expect,
  getPage,
  openPageScreen,
  pageEditor,
  pagePath,
  projectPath,
  replacePageContent,
  savedBadge,
  setFeatures,
  setPageTitle,
  toastText,
  treeItem,
  waitForStoredPage,
  workspaceId,
} from "./_support";

// Pages: project documents with a page tree, live collaboration, locking,
// archiving, version history, page links and mentions.

test.describe.configure({ timeout: 240_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Pages") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

test("Pages turns on in Features, and a page is created, written, renamed and kept after a reload", async ({
  page,
  api,
}) => {
  await setFeatures(api, project.id, { pagesEnabled: false });
  await page.goto(projectSettingsPath(project.id, "features"));
  const toggle = page.getByRole("switch", { name: "Pages", exact: true });
  await expect(toggle).not.toBeChecked({ timeout: 60_000 });
  await toggle.click();
  await expect(toastText(page, "Pages turned on")).toBeVisible();
  await expect(toggle).toBeChecked();

  await page.goto(projectPath(project.id, "pages"));
  await expect(page.getByText("Write your first page")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "New page" }).first().click();
  await expect(page).toHaveURL(/\/pages\/[^/?]+/);
  const pageId = page.url().split("/pages/")[1]?.split(/[?#]/)[0] ?? "";
  expect(pageId).not.toBe("");

  const title = uniqueName("Spec draft");
  await setPageTitle(page, api, pageId, title);
  const editor = pageEditor(page);
  await expect(editor).toHaveAttribute("contenteditable", "true", {
    timeout: 60_000,
  });
  await editor.click();
  await page.keyboard.type("Hello from the owner.");
  await expect(savedBadge(page)).toBeVisible({ timeout: 30_000 });
  await waitForStoredPage(
    api,
    pageId,
    (stored) =>
      stored.title === title &&
      stored.contentMarkdown.includes("Hello from the owner."),
    "the title and the first line",
  );

  await page.reload();
  await expect(page.getByLabel("Page title")).toHaveValue(title, {
    timeout: 60_000,
  });
  await expect(pageEditor(page)).toContainText("Hello from the owner.");

  // Rename: the title saves on blur.
  const renamed = uniqueName("Spec final");
  await page.getByLabel("Page title").fill(renamed);
  await page.getByLabel("Page title").press("Tab");
  await waitForStoredPage(
    api,
    pageId,
    (stored) => stored.title === renamed,
    "the new title",
  );
  await page.goto(projectPath(project.id, "pages"));
  await expect(
    page.getByRole("main").getByRole("link", { name: renamed }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByRole("main").getByRole("link", { name: title }),
  ).toHaveCount(0);
});

test("a sub-page nests under its parent in the tree and the list", async ({
  page,
  api,
}) => {
  const parentTitle = uniqueName("Handbook");
  const parent = await createPage(api, project.id, { title: parentTitle });
  await openPageScreen(page, project.id, parent.id);

  // The tree lives in the shell's context panel (Pages destination).
  await expect(
    page
      .locator('[data-slot="context-panel"]')
      .getByRole("tree", { name: "Pages" }),
  ).toBeVisible();
  const parentRow = treeItem(page, parentTitle);
  await expect(parentRow).toBeVisible();
  await expect(parentRow).toHaveAttribute("aria-level", "1");
  await parentRow.hover();
  await parentRow.getByRole("button", { name: "New sub-page" }).click();
  await expect(page).not.toHaveURL(new RegExp(`/pages/${parent.id}`));
  const childId = page.url().split("/pages/")[1]?.split(/[?#]/)[0] ?? "";

  const childTitle = uniqueName("Onboarding");
  await setPageTitle(page, api, childId, childTitle);
  expect((await getPage(api, childId)).parentId).toBe(parent.id);

  const childRow = treeItem(page, childTitle);
  await expect(childRow).toBeVisible();
  await expect(childRow).toHaveAttribute("aria-level", "2");
  await expect(childRow).toHaveAttribute("aria-selected", "true");
  await expect(parentRow).toHaveAttribute("aria-expanded", "true");

  // Above the title, the parent path leads back up.
  const parentPath = page.getByRole("navigation", { name: "Parent pages" });
  await expect(
    parentPath.getByRole("link", { name: parentTitle }),
  ).toBeVisible();

  // The document bar's switcher jumps between the project's pages.
  const toolbar = page.locator('[data-slot="page-toolbar"]');
  await toolbar.getByRole("button", { name: childTitle }).click();
  await page.getByRole("button", { name: parentTitle, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/${parent.id}`));
  await expect(
    toolbar.getByRole("button", { name: parentTitle }),
  ).toBeVisible();

  // The open page's ancestors are kept expanded; back on the parent, the
  // tree uses the remembered state, so expand and collapse it by hand.
  await parentRow.getByRole("link", { name: parentTitle }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/${parent.id}`));
  await expect(parentRow).toHaveAttribute("aria-selected", "true");
  const toggle = parentRow.getByRole("button", {
    name: new RegExp(`^(Expand|Collapse) ${escapeRegExp(parentTitle)}$`),
  });
  if ((await parentRow.getAttribute("aria-expanded")) === "false") {
    await expect(childRow).toHaveCount(0);
    await toggle.click();
  }
  await expect(parentRow).toHaveAttribute("aria-expanded", "true");
  await expect(childRow).toBeVisible();
  await parentRow
    .getByRole("button", { name: `Collapse ${parentTitle}` })
    .click();
  await expect(childRow).toHaveCount(0);
  await expect(parentRow).toHaveAttribute("aria-expanded", "false");
  await parentRow
    .getByRole("button", { name: `Expand ${parentTitle}` })
    .click();
  await expect(childRow).toBeVisible();

  // The list names the parent of a nested page.
  await page.goto(projectPath(project.id, "pages"));
  const listRow = page
    .locator("li")
    .filter({ has: page.getByRole("link", { name: childTitle }) });
  await expect(listRow).toContainText(`in ${parentTitle}`, {
    timeout: 60_000,
  });
});

test("a locked page is read-only for a member until the owner unlocks it", async ({
  page,
  api,
  apiAs,
  pageAs,
}) => {
  const title = uniqueName("Locked spec");
  const doc = await createPage(api, project.id, {
    title,
    content: "Settled decisions.",
  });
  await openPageScreen(page, project.id, doc.id);
  await page.getByRole("button", { name: "Lock page" }).click();
  await expect(toastText(page, "Page locked")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Locked", exact: true }),
  ).toBeVisible();
  expect((await getPage(api, doc.id)).isLocked).toBe(true);

  const member = await pageAs("member");
  await openPageScreen(member, project.id, doc.id, { editable: false });
  await expect(
    member.getByText("This page is locked. Unlock it to make changes."),
  ).toBeVisible();
  await expect(pageEditor(member)).toContainText("Settled decisions.");
  await expect(pageEditor(member)).toHaveAttribute("contenteditable", "false");
  await expect(member.getByLabel("Page title")).not.toBeEditable();
  // Only the owner or a manager can unlock it.
  await expect(member.getByRole("button", { name: "Unlock" })).toHaveCount(0);
  await expect(member.getByRole("button", { name: "Lock page" })).toHaveCount(
    0,
  );

  // The API refuses the member's edit too.
  const memberApi = await apiAs("member");
  const refused = await memberApi.put(`/api/page/${doc.id}/content`, {
    data: { markdown: "Sneaky edit" },
  });
  expect(refused.status()).toBe(409);

  // Unlocking reaches the member's open page live.
  await page.getByRole("button", { name: "Locked", exact: true }).click();
  await expect(toastText(page, "Page unlocked")).toBeVisible();
  await expect(pageEditor(member)).toHaveAttribute("contenteditable", "true", {
    timeout: 30_000,
  });
  await expect(
    member.getByText("This page is locked. Unlock it to make changes."),
  ).toHaveCount(0);
});

test("a page is archived, restored, archived again and deleted", async ({
  page,
  api,
}) => {
  const title = uniqueName("Old notes");
  const doc = await createPage(api, project.id, { title, content: "Old." });
  await openPageScreen(page, project.id, doc.id);

  await page.getByRole("button", { name: "Page actions" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(toastText(page, "Page archived")).toBeVisible();
  const banner = page.getByText("This page is archived. Restore it to edit.");
  await expect(banner).toBeVisible();
  await expect(pageEditor(page)).toHaveAttribute("contenteditable", "false");

  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(toastText(page, "Page restored")).toBeVisible();
  await expect(banner).toHaveCount(0);
  expect((await getPage(api, doc.id)).archivedAt).toBeNull();

  // Archive from the list's row menu, then delete from the Archived tab.
  await page.goto(projectPath(project.id, "pages"));
  const link = page.getByRole("main").getByRole("link", { name: title });
  await expect(link).toBeVisible({ timeout: 60_000 });
  await page
    .getByRole("main")
    .getByRole("button", { name: `More actions for ${title}` })
    .click();
  await expect(page.getByRole("menuitem", { name: "Delete…" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(toastText(page, "Page archived")).toBeVisible();
  await expect(link).toHaveCount(0);

  await page.getByRole("tab", { name: /Archived/ }).click();
  await expect(link).toBeVisible();
  await expect(page.getByText(/^Archived /).first()).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("button", { name: `More actions for ${title}` })
    .click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete page?" });
  await expect(confirm).toContainText(title);
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(toastText(page, "Page deleted")).toBeVisible();
  // The project has no pages left at all.
  await expect(page.getByText("Write your first page")).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Archived\s*0$/ })).toBeVisible();
  expect((await api.get(`/api/page/${doc.id}`)).status()).toBe(404);
});

test("an earlier version is previewed and restored", async ({
  page,
  api,
  apiAs,
}) => {
  const title = uniqueName("Versioned");
  const doc = await createPage(api, project.id, { title });
  // Two people's saves make two versions (one person's edits coalesce).
  await replacePageContent(api, doc.id, "Owner wrote the first version.");
  await replacePageContent(
    await apiAs("member"),
    doc.id,
    "Member rewrote everything.",
  );

  await openPageScreen(page, project.id, doc.id, { search: "?panel=history" });
  await expect(pageEditor(page)).toContainText("Member rewrote everything.");
  const history = page.getByRole("list", { name: "Version history" });
  await expect(history).toBeVisible();
  await expect(
    history.getByRole("button", { name: "Current version" }),
  ).toBeVisible();
  const ownerVersion = history
    .getByRole("button")
    .filter({ hasText: "Olivia Owner" });
  await expect(ownerVersion).toHaveCount(1);
  await expect(
    history.getByRole("button").filter({ hasText: "Mia Member" }),
  ).toHaveCount(1);

  await ownerVersion.click();
  await expect(page.getByText("View only")).toBeVisible();
  await expect(page.getByText("Owner wrote the first version.")).toBeVisible();
  await expect(page).toHaveURL(/version=/);

  await page.getByRole("button", { name: "Restore", exact: true }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Restore this version?",
  });
  await expect(
    confirm.getByText(
      "The current content is saved to the history first, so you can undo this.",
    ),
  ).toBeVisible();
  await confirm.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(toastText(page, "Version restored")).toBeVisible();
  await waitForStoredPage(
    api,
    doc.id,
    (stored) =>
      stored.contentMarkdown.includes("Owner wrote the first version.") &&
      !stored.contentMarkdown.includes("Member rewrote"),
    "the restored content",
  );
  // The page may return to the current version on its own after a restore,
  // so the button can disappear mid-click; the editor check below decides.
  const back = page.getByRole("button", { name: "Back to current" });
  if (await back.isVisible()) {
    await back.click({ timeout: 5_000 }).catch(() => undefined);
  }
  // The live editor re-syncs after a restore; slow on a busy server.
  await expect(pageEditor(page)).toContainText(
    "Owner wrote the first version.",
    { timeout: 60_000 },
  );
  await expect(pageEditor(page)).not.toContainText("Member rewrote");
});

test("a page link from one page shows as a backlink on the other", async ({
  page,
  api,
}) => {
  const targetTitle = uniqueName("Glossary");
  const target = await createPage(api, project.id, { title: targetTitle });
  const sourceTitle = uniqueName("Spec");
  const source = await createPage(api, project.id, { title: sourceTitle });

  await openPageScreen(page, project.id, source.id);
  const editor = pageEditor(page);
  await editor.click();
  await page.keyboard.type("See ");
  await page.keyboard.type("/wiki");
  await page
    .locator(".margaya-tiptap-slash-menu")
    .getByRole("button", { name: /Link to page/ })
    .click();
  const search = page.getByRole("textbox", { name: "Search pages" }).last();
  await expect(search).toBeVisible();
  await search.fill(targetTitle.split(" ")[0] ?? targetTitle);
  await page
    .getByRole("option", { name: new RegExp(escapeRegExp(targetTitle)) })
    .click();
  await expect(editor).toContainText(targetTitle);
  await waitForStoredPage(
    api,
    source.id,
    (stored) =>
      stored.contentMarkdown.includes(`margaya-page-link id="${target.id}"`),
    "the page link",
  );

  const backlinks = await readJson<{ id: string }[]>(
    await api.get(`/api/page/${target.id}/backlinks`),
    "backlinks",
  );
  expect(backlinks.map((entry) => entry.id)).toEqual([source.id]);

  await openPageScreen(page, project.id, target.id, { search: "?panel=info" });
  const info = page.getByRole("tabpanel", { name: "Info" });
  await expect(info.getByText("Linked from")).toBeVisible();
  const backlink = info.getByRole("link", { name: sourceTitle });
  await expect(backlink).toBeVisible();
  await backlink.click();
  await expect(page).toHaveURL(new RegExp(`/pages/${source.id}`));
});

test("an @mention in a page notifies the member", async ({
  page,
  api,
  apiAs,
  pageAs,
  seed,
}) => {
  const title = uniqueName("Mention page");
  const doc = await createPage(api, project.id, { title });
  await openPageScreen(page, project.id, doc.id);
  await pageEditor(page).click();
  await page.keyboard.type("Over to you @Mia");
  await page
    .locator(".margaya-mention-list")
    .getByRole("button", { name: "Mia Member" })
    .click();
  await expect(pageEditor(page)).toContainText("Mia Member");
  await waitForStoredPage(
    api,
    doc.id,
    (stored) =>
      stored.contentMarkdown.includes(
        `margaya-mention id="${seed.users.member.id}"`,
      ),
    "the stored mention",
  );

  const memberApi = await apiAs("member");
  const notification = await waitForNotification(
    memberApi,
    (entry) => entry.type === "page_mention" && entry.resourceId === doc.id,
    "the page mention",
  );
  expect(notification.resourceType).toBe("page");
  expect(notification.eventData).toMatchObject({
    pageTitle: title,
    mentionerName: "Olivia Owner",
    projectId: project.id,
  });

  // The member's inbox lists it under Mentions; its preview opens the page.
  const member = await pageAs("member");
  await member.goto(`/dashboard/workspace/${workspaceId()}/inbox`);
  const list = member.getByRole("listbox", { name: "Notifications" });
  await expect(list).toBeVisible({ timeout: 60_000 });
  await member.getByRole("tab", { name: /^Mentions/ }).click();
  const row = list
    .getByRole("option")
    .filter({ hasText: `mentioned you in ${title}` })
    .first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(
    member.getByText(`Olivia Owner mentioned you in: ${title}`),
  ).toBeVisible();
  await member.getByRole("button", { name: "Open page" }).click();
  await expect(member).toHaveURL(new RegExp(`/pages/${doc.id}`));
  await expect(pageEditor(member)).toContainText("Over to you", {
    timeout: 60_000,
  });
});

test("the inbox row of a page mention names the page", async ({
  api,
  apiAs,
  pageAs,
  seed,
}) => {
  const title = uniqueName("Named page");
  const doc = await createPage(api, project.id, {
    title,
    content: `Hello <margaya-mention id="${seed.users.member.id}" label="Mia Member"></margaya-mention>`,
  });
  await waitForNotification(
    await apiAs("member"),
    (entry) => entry.type === "page_mention" && entry.resourceId === doc.id,
    "the page mention",
  );
  const member = await pageAs("member");
  await member.goto(`/dashboard/workspace/${workspaceId()}/inbox`);
  const row = member
    .getByRole("listbox", { name: "Notifications" })
    .getByRole("option")
    .filter({ hasText: "mentioned you in" })
    .filter({ hasText: title })
    .first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row).toContainText(title, { timeout: 10_000 });
});

test("owner and member typing at once converge, and each sees the other's presence", async ({
  page,
  api,
  pageAs,
}) => {
  const doc = await createPage(api, project.id, {
    title: uniqueName("Collab"),
  });
  const member = await pageAs("member");
  await openPageScreen(page, project.id, doc.id);
  await openPageScreen(member, project.id, doc.id);

  // Presence: each side lists the other person.
  await expect(
    page.locator('ul[aria-label^="People on this page"]'),
  ).toHaveAttribute("aria-label", /Mia Member/, { timeout: 30_000 });
  await expect(
    member.locator('ul[aria-label^="People on this page"]'),
  ).toHaveAttribute("aria-label", /Olivia Owner/, { timeout: 30_000 });

  const ownerEditor = pageEditor(page);
  const memberEditor = pageEditor(member);
  await ownerEditor.click();
  await page.keyboard.type("Owner first line.", { delay: 20 });
  await page.keyboard.press("Enter");
  await expect(memberEditor).toContainText("Owner first line.");

  await memberEditor.click();
  await member.keyboard.press("Control+End");
  await Promise.all([
    page.keyboard.type("Owner second line.", { delay: 30 }),
    (async () => {
      await member.keyboard.press("Control+Home");
      await member.keyboard.type("Member: ", { delay: 30 });
    })(),
  ]);

  // Both sides end with the same text, holding every keystroke.
  await expect
    .poll(
      async () => {
        const [a, b] = await Promise.all([
          ownerEditor.innerText(),
          memberEditor.innerText(),
        ]);
        return a === b ? a : `diverged: ${a} | ${b}`;
      },
      { timeout: 30_000 },
    )
    .toMatch(/Member: [\s\S]*Owner second line\./);
  const text = await ownerEditor.innerText();
  expect(text).toContain("Owner first line.");
  expect(text).toContain("Owner second line.");
  expect(text).toContain("Member: ");

  // Remote carets carry the other person's name.
  await expect(page.locator(".margaya-collab-caret-label")).toContainText([
    "Mia Member",
  ]);

  await waitForStoredPage(
    api,
    doc.id,
    (stored) =>
      stored.contentMarkdown.includes("Owner second line.") &&
      stored.contentMarkdown.includes("Member: "),
    "the merged content",
  );
  await member.reload();
  await expect(pageEditor(member)).toContainText("Owner second line.", {
    timeout: 60_000,
  });
  await expect(pageEditor(member)).toContainText("Member: ");
});

test("a task lists the pages that mention it", async ({ page, api }) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Referenced task"),
  });
  const key = `${project.slug}-${task.number}`;
  const title = uniqueName("Release plan");
  const url = `${E2E_WEB_URL}${taskPagePath(project.id, task.id)}`;
  const doc = await createPage(api, project.id, {
    title,
    content: `Ship it.\n\n<margaya-issue-link url="${url}" issue-key="${key}" task-id="${task.id}" />\n`,
  });

  const references = await readJson<{ id: string }[]>(
    await api.get(`/api/page/task/${task.id}/references`),
    "task page references",
  );
  expect(references.map((entry) => entry.id)).toEqual([doc.id]);

  await openTaskPage(page, taskPagePath(project.id, task.id));
  const section = page.getByRole("button", { name: "Mentioned in pages" });
  await expect(section).toBeVisible();
  const link = page.getByRole("link", { name: title });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(
    new RegExp(escapeRegExp(pagePath(project.id, doc.id))),
  );
  await expect(pageEditor(page)).toContainText("Ship it.", { timeout: 60_000 });
});
