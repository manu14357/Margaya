import { expect, test } from "../../../fixtures";
import {
  createProject,
  createTask,
  deleteProject,
  type TestProject,
} from "../../../helpers/task-data";
import { uniqueName } from "../../../helpers/ui";

// Readable task links: /dashboard/workspace/<id>/task/KEY-123 resolve the key
// in the workspace and replace themselves with the task's page.

test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Links") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

test("a KEY-123 link opens the task page", async ({ page, api, seed }) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Linked task"),
  });
  const key = `${project.slug}-${task.number}`;

  // Keys are case-insensitive in links.
  await page.goto(
    `/dashboard/workspace/${seed.workspace.id}/task/${key.toLowerCase()}`,
  );
  await expect(page).toHaveURL(
    new RegExp(
      `/dashboard/workspace/${seed.workspace.id}/project/${project.id}/task/${task.id}$`,
    ),
    { timeout: 60_000 },
  );
  await expect(
    page.getByRole("textbox", { name: "Click to add a title" }),
  ).toHaveValue(task.title, { timeout: 60_000 });
});

test("an unknown key shows a not-found page", async ({ page, seed }) => {
  const key = `${project.slug}-99999`;
  await page.goto(`/dashboard/workspace/${seed.workspace.id}/task/${key}`);

  await expect(
    page.getByRole("heading", { name: "Task not found" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText(
      `No task with the key ${key} in this workspace, or you can't see it.`,
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Go to Home" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/workspace/${seed.workspace.id}$`),
  );
});
