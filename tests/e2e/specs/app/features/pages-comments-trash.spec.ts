import { test } from "../../../fixtures";
import {
  createProject,
  deleteProject,
  type TestProject,
} from "../../../helpers/task-data";
import { uniqueName } from "../../../helpers/ui";
import {
  createPage,
  expect,
  getPage,
  openPageScreen,
  projectPath,
  toastText,
} from "./_support";

// Page comments, watching, and deleted pages going through the trash.

test.describe.configure({ timeout: 240_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Page trash") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

test("a page takes comments, and can be watched and unwatched", async ({
  page,
  api,
}) => {
  const doc = await createPage(api, project.id, {
    title: uniqueName("Discussed"),
    content: "Body.",
  });
  await openPageScreen(page, project.id, doc.id, {
    search: "?panel=comments",
  });

  const panel = page.getByRole("complementary", { name: "Comments" });
  await expect(panel.getByText("No comments yet")).toBeVisible();

  const composer = panel.locator(".ProseMirror[contenteditable='true']").last();
  await composer.click();
  await page.keyboard.type("Is this still right?");
  await panel.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(panel.getByText("Is this still right?")).toBeVisible();
  await expect(panel.getByText("No comments yet")).toHaveCount(0);

  // Commenting starts watching; the button stops it, and starts it again.
  const stop = page.getByRole("button", { name: "Stop watching" });
  await expect(stop).toHaveAttribute("aria-pressed", "true");
  await stop.click();
  const watch = page.getByRole("button", { name: "Watch page" });
  await expect(watch).toHaveAttribute("aria-pressed", "false");
  await watch.click();
  await expect(stop).toBeVisible();

  // The comment stays after a reload, and is removed only after confirming.
  await page.reload();
  await expect(panel.getByText("Is this still right?")).toBeVisible({
    timeout: 60_000,
  });
  await panel
    .getByRole("button", { name: "More actions for this comment" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Delete this comment?",
  });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(panel.getByText("No comments yet")).toBeVisible();
});

test("a deleted page waits in the trash, is restored, and is deleted for good", async ({
  page,
  api,
}) => {
  const title = uniqueName("Old runbook");
  const doc = await createPage(api, project.id, { title, content: "Keep me." });

  const moveToTrash = async () => {
    expect((await api.post(`/api/page/${doc.id}/archive`)).ok()).toBe(true);
    expect((await api.delete(`/api/page/${doc.id}`)).ok()).toBe(true);
  };
  await moveToTrash();
  expect((await api.get(`/api/page/${doc.id}`)).status()).toBe(404);

  // From the Archived tab, to the project's Recently deleted.
  await page.goto(`${projectPath(project.id, "pages")}?tab=archived`);
  await page
    .getByRole("link", { name: "Recently deleted" })
    .click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/settings\/projects\/.+\/trash/);

  const name = page.getByText(title, { exact: true });
  await expect(name).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: `Restore ${title}` }).click();
  await expect(toastText(page, "Page restored to Archived")).toBeVisible();
  await expect(name).toHaveCount(0);
  const restored = await getPage(api, doc.id);
  expect(restored.archivedAt).not.toBeNull();
  expect(restored.contentMarkdown).toContain("Keep me.");

  // Delete from the trash: gone for good, only after confirming.
  expect((await api.delete(`/api/page/${doc.id}`)).ok()).toBe(true);
  await page.reload();
  await expect(name).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: `More actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Delete permanently" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Delete this page permanently?",
  });
  await expect(confirm).toContainText(title);
  await confirm.getByRole("button", { name: "Delete permanently" }).click();
  await expect(toastText(page, "Page deleted permanently")).toBeVisible();
  await expect(name).toHaveCount(0);
});
