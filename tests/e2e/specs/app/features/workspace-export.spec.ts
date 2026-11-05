import { test } from "../../../fixtures";
import { authFile } from "../../../helpers/auth";
import {
  createProject,
  createTask,
  deleteProject,
  type TestProject,
} from "../../../helpers/task-data";
import { uniqueName } from "../../../helpers/ui";
import { expect, toastText } from "./_support";

// Settings > Workspace > Exports: an admin exports the whole workspace as one
// ZIP in the background and downloads it. The e2e API runs without file storage,
// so the file is kept in Postgres and the archive holds no attachments.

test.describe.configure({ timeout: 300_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject | undefined;

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
  project = undefined;
});

test("an admin exports the whole workspace, downloads it and deletes it", async ({
  page,
  api,
}) => {
  project = await createProject(api, { name: uniqueName("Whole export") });
  await createTask(api, project.id, { title: uniqueName("In the archive") });

  await page.goto("/dashboard/settings/workspace/exports");
  await expect(
    page.getByRole("heading", { name: "Whole workspace", exact: true }),
  ).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "Export workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Export whole workspace" });
  await expect(
    dialog.getByRole("switch", { name: "Include files" }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(
    toastText(page, "Export started. We'll let you know when it's ready."),
  ).toBeVisible();
  await expect(dialog).toBeHidden();

  const row = page
    .getByRole("row")
    .filter({ hasText: "Whole workspace" })
    .first();
  await expect(row).toBeVisible();
  await expect(async () => {
    if (!(await row.getByText("Ready").isVisible())) await page.reload();
    await expect(row.getByText("Ready")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000, intervals: [2_000, 5_000] });

  const downloadPromise = page.waitForEvent("download");
  await row.getByRole("button", { name: /^Download / }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-workspace-.*\.zip$/);

  // Past 256 MB the file goes to the browser's own download, through a link
  // only the session cookie authorizes. Say this archive is that large.
  await page.route("**/api/task-export?*", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: Record<string, unknown>[];
    };
    await route.fulfill({
      response,
      json: {
        ...body,
        items: body.items.map((item) => ({
          ...item,
          sizeBytes: 300 * 1024 * 1024,
        })),
      },
    });
  });
  await page.reload();
  const linkDownloadPromise = page.waitForEvent("download");
  await row.getByRole("button", { name: /^Download / }).click();
  const linkDownload = await linkDownloadPromise;
  expect(linkDownload.suggestedFilename()).toMatch(/-workspace-.*\.zip$/);
  expect(await linkDownload.failure()).toBeNull();

  await row.getByRole("button", { name: /^Delete / }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Delete this export?",
  });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(toastText(page, "Export deleted")).toBeVisible();
});

test("a member doesn't get the whole-workspace export", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: authFile("member"),
  });
  const page = await context.newPage();
  await page.goto("/dashboard/settings/workspace/exports");
  await expect(
    page.getByRole("heading", { name: "Exports", exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByRole("button", { name: "Export workspace" }),
  ).toHaveCount(0);
  await context.close();
});
