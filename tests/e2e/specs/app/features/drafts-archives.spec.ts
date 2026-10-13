import type { APIRequestContext, Page } from "@playwright/test";
import pg from "pg";
import { test } from "../../../fixtures";
import { E2E_DATABASE_URL } from "../../../helpers/env";
import { readJson } from "../../../helpers/http";
import {
  boardPath,
  createProject,
  createTask,
  deleteProject,
  getTask,
  listBoard,
  type TestProject,
} from "../../../helpers/task-data";
import {
  boardColumn,
  createTaskDialog,
  taskCard,
  waitForBoardReady,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";
import {
  expect,
  toastText,
  workspaceId,
  workspaceSectionPath,
} from "./_support";

// Drafts (save from the create dialog, list, count, publish, delete),
// Archives (tasks and projects) and scheduled automations.

test.describe.configure({ timeout: 240_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Drafts") });
});

test.afterEach(async ({ api }) => {
  // Drafts this file created (also from interrupted runs).
  for (const draft of await listDrafts(api).catch(() => [])) {
    if (/^Draft (publish|delete) /.test(draft.title)) {
      await api.delete(`/api/task-draft/${draft.id}`).catch(() => null);
    }
  }
  if (project) {
    await api.post(`/api/project/${project.id}/unarchive`).catch(() => null);
    await deleteProject(api, project.id);
  }
});

type Draft = { id: string; title: string; projectId: string | null };

async function draftCount(api: APIRequestContext): Promise<number> {
  const body = await readJson<{ count: number }>(
    await api.get("/api/task-draft/count", {
      params: { workspaceId: workspaceId() },
    }),
    "count drafts",
  );
  return body.count;
}

async function listDrafts(api: APIRequestContext): Promise<Draft[]> {
  const body = await readJson<{ items?: Draft[]; drafts?: Draft[] }>(
    await api.get("/api/task-draft", {
      params: { workspaceId: workspaceId(), limit: 100 },
    }),
    "list drafts",
  );
  return body.items ?? body.drafts ?? [];
}

/** The Personal group's "Drafts" entry; it shows a count while there are any. */
function draftsNav(page: Page) {
  return page
    .getByRole("complementary", { name: "Section navigation" })
    .getByRole("button", { name: /^Drafts( \d+| 99\+)?$/ });
}

async function saveDraftFromBoard(page: Page, title: string) {
  await boardColumn(page, "To Do")
    .getByRole("button", { name: "Add task" })
    .click();
  const dialog = createTaskDialog(page);
  await dialog.getByPlaceholder("Task title").fill(title);
  await dialog.getByRole("button", { name: "Save as draft" }).click();
  await expect(toastText(page, "Saved to drafts")).toBeVisible();
  await expect(dialog).toBeHidden();
}

test("a task saved as a draft is counted, listed, published and deleted", async ({
  page,
  api,
}) => {
  const before = await draftCount(api);
  const keep = uniqueName("Draft publish");
  const drop = uniqueName("Draft delete");

  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);
  await saveDraftFromBoard(page, keep);
  await saveDraftFromBoard(page, drop);
  // Drafts never reach the board.
  await expect(taskCard(page, keep)).toHaveCount(0);
  await expect.poll(() => draftCount(api)).toBe(before + 2);
  const drafts = await listDrafts(api);
  expect(drafts.find((draft) => draft.title === keep)?.projectId).toBe(
    project.id,
  );

  // Drafts sit in the My work panel, so the check opens that destination.
  await page.goto(workspaceSectionPath("my-work"));
  await expect(draftsNav(page)).toHaveAccessibleName(
    `Drafts ${before + 2 > 99 ? "99+" : before + 2}`,
  );
  await draftsNav(page).click();
  await expect(page).toHaveURL(/\/drafts$/);
  await expect(page.getByText("Only you can see your drafts.")).toBeVisible();
  const row = (title: string) =>
    page.getByRole("button").filter({ hasText: title }).first();
  await expect(row(keep)).toBeVisible();
  await expect(row(drop)).toBeVisible();

  // Publish one from its row menu.
  await row(keep).hover();
  await row(keep).getByRole("button", { name: "Draft actions" }).click();
  await page.getByRole("menuitem", { name: "Publish" }).click();
  await expect(
    toastText(page, new RegExp(`^Published ${project.slug}-\\d+`)),
  ).toBeVisible();
  await expect(row(keep)).toHaveCount(0);
  await expect.poll(() => draftCount(api)).toBe(before + 1);
  const board = await listBoard(api, project.id);
  const published = board.columns
    .flatMap((column) => column.tasks)
    .find((task) => task.title === keep);
  expect(published, "the published task is on the board").toBeTruthy();

  // Delete the other one.
  await row(drop).hover();
  await row(drop).getByRole("button", { name: "Draft actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this draft?" });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(toastText(page, "Draft deleted")).toBeVisible();
  await expect(row(drop)).toHaveCount(0);
  await expect.poll(() => draftCount(api)).toBe(before);
  if (before === 0) {
    await expect(page.getByText("No drafts")).toBeVisible();
  }
});

test("an archived task is restored from Archives", async ({ page, api }) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Archived task"),
  });
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);
  await taskCard(page, task.title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(taskCard(page, task.title)).toHaveCount(0);
  await expect
    .poll(async () => Boolean((await getTask(api, task.id)).archivedAt))
    .toBe(true);

  // The project's Archives list it.
  await page.goto(
    `/dashboard/workspace/${workspaceId()}/project/${project.id}/archives`,
  );
  await expect(
    page.getByText(
      "Archived items are hidden from boards, lists and counts. Restore them to put them back where they were.",
    ),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("tab", { name: /^Tasks\s*1$/ })).toBeVisible();
  const restore = page.getByRole("button", {
    name: `Restore ${task.title}`,
    exact: true,
  });
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(toastText(page, "Task restored")).toBeVisible();
  await expect(restore).toHaveCount(0);
  await expect(page.getByText("No archived tasks")).toBeVisible();
  await expect
    .poll(async () => (await getTask(api, task.id)).archivedAt ?? null)
    .toBeNull();

  await page.goto(boardPath(project.id));
  await expect(taskCard(boardColumn(page, "To Do"), task.title)).toBeVisible({
    timeout: 60_000,
  });
});

test("an archived project is listed in workspace Archives and restored", async ({
  page,
  api,
}) => {
  await page.goto(`/dashboard/settings/projects/${project.id}/general`);
  await page.getByRole("button", { name: "Archive project" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: `Archive ${project.name}?`,
  });
  await confirm.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(toastText(page, "Project archived")).toBeVisible();
  await expect
    .poll(async () => {
      const body = await readJson<{ archivedAt?: string | null }>(
        await api.get(`/api/project/${project.id}`, {
          params: { workspaceId: workspaceId() },
        }),
        "get project",
      );
      return Boolean(body.archivedAt);
    })
    .toBe(true);

  await page.goto(`${workspaceSectionPath("archives")}?tab=projects`);
  const restore = page.getByRole("button", {
    name: `Restore ${project.name}`,
    exact: true,
  });
  await expect(restore).toBeVisible({ timeout: 60_000 });
  await restore.click();
  await expect(toastText(page, "Project restored")).toBeVisible();
  await expect(restore).toHaveCount(0);
  await expect
    .poll(async () => {
      const body = await readJson<{ archivedAt?: string | null }>(
        await api.get(`/api/project/${project.id}`, {
          params: { workspaceId: workspaceId() },
        }),
        "get project",
      );
      return body.archivedAt ?? null;
    })
    .toBeNull();
});

/**
 * Makes a task look untouched for `days` days. Time can't be advanced through
 * the API, so this setup step writes the e2e database directly.
 */
async function backdateTask(taskId: string, days: number) {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      "UPDATE task SET updated_at = now() - make_interval(days => $2) WHERE id = $1",
      [taskId, days],
    );
    if (result.rowCount !== 1) throw new Error(`task ${taskId} not found`);
  } finally {
    await client.end();
  }
}

test("scheduled automations preview what they would archive before turning on", async ({
  page,
  api,
}) => {
  const done = project.columns.find((column) => column.group === "completed");
  test.skip(!done, "the default workflow has no completed column");
  const stale = await createTask(api, project.id, {
    title: uniqueName("Stale done"),
    status: done?.slug ?? "done",
  });
  await createTask(api, project.id, { title: uniqueName("Fresh done") });
  await backdateTask(stale.id, 200);

  await page.goto(`/dashboard/settings/projects/${project.id}/workflow`);
  await expect(
    page.getByRole("heading", { name: "Scheduled automations" }),
  ).toBeVisible({
    timeout: 60_000,
  });
  const autoArchive = page.getByRole("switch", {
    name: "Auto-archive closed tasks",
  });
  const autoClose = page.getByRole("switch", {
    name: "Auto-close stale tasks",
  });
  await expect(autoArchive).not.toBeChecked();
  await expect(autoClose).not.toBeChecked();

  const preview = await readJson<{ count: number }>(
    await api.get(`/api/project-automation/${project.id}/preview`, {
      params: { workspaceId: workspaceId(), rule: "archive", months: 3 },
    }),
    "automation preview",
  );
  expect(preview.count).toBe(1);

  // Turning on asks first: one closed task would be archived.
  await autoArchive.click();
  const confirm = page.getByRole("alertdialog", {
    name: "Turn on auto-archive?",
  });
  await expect(confirm).toContainText(
    /1 closed tasks haven't been updated for \d+ months?\. They'll be archived within the next hour\./,
  );
  await confirm.getByRole("button", { name: "Turn on" }).click();
  await expect(toastText(page, "Auto-archive turned on")).toBeVisible();
  await expect(autoArchive).toBeChecked();
  await expect(page.getByText("1 task matches right now")).toBeVisible();
  await expect(page.getByText("Nothing archived yet")).toBeVisible();

  // Off again (the hourly job is not awaited); the task is untouched.
  await autoArchive.click();
  await expect(toastText(page, "Auto-archive turned off")).toBeVisible();
  await expect(autoArchive).not.toBeChecked();
  expect((await getTask(api, stale.id)).archivedAt ?? null).toBeNull();
});
