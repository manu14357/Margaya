import { expect, test } from "../../../fixtures";
import {
  boardPath,
  createProject,
  createTask,
  deleteProject,
  getTask,
  type TestProject,
  type TestTask,
} from "../../../helpers/task-data";
import {
  boardColumn,
  taskCard,
  toast,
  waitForBoardReady,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let source: TestProject;
let destination: TestProject;
let tasks: TestTask[];
let bystander: TestTask;

test.beforeEach(async ({ api }) => {
  source = await createProject(api, { name: uniqueName("Bulk move source") });
  destination = await createProject(api, {
    name: uniqueName("Bulk move destination"),
  });
  tasks = [
    await createTask(api, source.id, { title: uniqueName("Move one") }),
    await createTask(api, source.id, { title: uniqueName("Move two") }),
  ];
  bystander = await createTask(api, source.id, {
    title: uniqueName("Stays here"),
  });
});

test.afterEach(async ({ api }) => {
  if (source) await deleteProject(api, source.id);
  if (destination) await deleteProject(api, destination.id);
});

test("selected tasks move to another project after confirming the rule", async ({
  page,
  api,
}) => {
  await page.goto(boardPath(source.id));
  await waitForBoardReady(page);

  for (const task of tasks) {
    await taskCard(page, task.title).click({ modifiers: ["ControlOrMeta"] });
  }
  const bar = page.getByRole("toolbar");
  await expect(bar.getByText("2 selected")).toBeVisible();

  await bar.getByRole("button", { name: "Actions" }).click();
  const palette = page
    .getByRole("dialog")
    .filter({ has: page.getByPlaceholder("Search actions...") });
  await palette
    .getByRole("group", { name: "Move to project" })
    .getByRole("option", { name: destination.name })
    .click();
  await expect(palette).toBeHidden();

  const confirm = page.getByRole("alertdialog");
  await expect(
    confirm.getByText(`Move 2 tasks to ${destination.name}?`),
  ).toBeVisible();
  await expect(confirm.getByText(/They get new task keys/)).toBeVisible();

  // Cancelling keeps the tasks and the selection.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(bar.getByText("2 selected")).toBeVisible();
  await expect(taskCard(page, tasks[0]?.title ?? "")).toBeVisible();

  await bar.getByRole("button", { name: "Actions" }).click();
  await palette
    .getByRole("group", { name: "Move to project" })
    .getByRole("option", { name: destination.name })
    .click();
  await confirm.getByRole("button", { name: "Move tasks" }).click();

  await expect(
    toast(page, `Moved 2 tasks to ${destination.name}`),
  ).toBeVisible();
  await expect(page.getByRole("toolbar")).toBeHidden();
  for (const task of tasks) {
    await expect(taskCard(page, task.title)).toHaveCount(0);
  }
  await expect(taskCard(page, bystander.title)).toBeVisible();

  for (const task of tasks) {
    const moved = await getTask(api, task.id);
    expect(moved.projectId).toBe(destination.id);
    expect(moved.status).toBe(task.status);
  }

  await page.goto(boardPath(destination.id));
  await waitForBoardReady(page);
  for (const task of tasks) {
    await expect(
      taskCard(boardColumn(page, "To Do"), task.title),
    ).toBeVisible();
  }
});
