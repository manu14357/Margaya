import { expect, test } from "../../../fixtures";
import {
  createProject,
  createTask,
  deleteProject,
  type TestProject,
} from "../../../helpers/task-data";
import { toast } from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// Deleting a task moves it to the project's trash (Settings → project →
// Recently deleted), where it can be restored.

test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Trash") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

test("a deleted task is restored from the project trash", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Trashed task"),
  });
  expect((await api.delete(`/api/task/${task.id}`)).status()).toBe(200);
  expect((await api.get(`/api/task/${task.id}`)).status()).toBe(404);

  await page.goto(`/dashboard/settings/projects/${project.id}/trash`);
  await expect(
    page.getByRole("heading", { name: "Recently deleted" }).first(),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(task.title)).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(`${project.slug}-${task.number}`, { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: `Restore ${task.title}` }).click();
  await expect(toast(page, "Task restored")).toBeVisible();
  await expect(page.getByText("No deleted tasks")).toBeVisible();

  const restored = await api.get(`/api/task/${task.id}`);
  expect(restored.status()).toBe(200);
  expect((await restored.json()).title).toBe(task.title);
});
