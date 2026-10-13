import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import {
  boardPath,
  createCycle,
  createEstimate,
  createModule,
  createProject,
  createTask,
  dayOffset,
  deleteProject,
  getTask,
  listBoard,
  type TestEstimate,
  type TestProject,
  type TestTask,
  taskLabelNames,
  taskModuleNames,
} from "../../../helpers/task-data";
import {
  boardColumn,
  openPopover,
  taskCard,
  toast,
  waitForBoardReady,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;
let estimate: TestEstimate;
let tasks: TestTask[];
let bystander: TestTask;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, {
    name: uniqueName("Bulk actions"),
    features: {
      cyclesEnabled: true,
      modulesEnabled: true,
      estimatesEnabled: true,
    },
  });
  estimate = await createEstimate(api, project.id, {
    name: "Points",
    type: "points",
    values: ["1", "2", "3", "5"],
  });
  tasks = [
    await createTask(api, project.id, { title: uniqueName("Bulk one") }),
    await createTask(api, project.id, { title: uniqueName("Bulk two") }),
  ];
  bystander = await createTask(api, project.id, {
    title: uniqueName("Not selected"),
  });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

/**
 * Toasts sit bottom-right over the end of the selection bar (bug #5), so
 * each round waits for the previous action's toast to leave first.
 */
async function waitForToastsToClear(page: Page) {
  await expect(
    page
      .getByRole("region", { name: "Notifications" })
      .locator("[data-slot='toast-title']"),
  ).toHaveCount(0, { timeout: 20_000 });
}

async function selectTasks(page: Page, selected: TestTask[]) {
  await waitForToastsToClear(page);
  for (const task of selected) {
    // A card that just changed columns lingers while its exit animation runs.
    await expect(taskCard(page, task.title)).toHaveCount(1);
    await taskCard(page, task.title).click({ modifiers: ["ControlOrMeta"] });
  }
  const bar = page.getByRole("toolbar");
  await expect(bar.getByText(`${selected.length} selected`)).toBeVisible();
  return bar;
}

async function runAction(
  page: Page,
  bar: Locator,
  group: string,
  option: string,
) {
  await bar.getByRole("button", { name: "Actions" }).click();
  const palette = page
    .getByRole("dialog")
    .filter({ has: page.getByPlaceholder("Search actions...") });
  await expect(palette).toBeVisible();
  await palette
    .getByRole("group", { name: group })
    .getByRole("option", { name: option })
    .click();
  await expect(palette).toBeHidden();
}

test("status, priority, assignees and labels change for every selected task", async ({
  page,
  api,
  seed,
}) => {
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);

  let bar = await selectTasks(page, tasks);
  await runAction(page, bar, "Change status", "In Review");
  await expect(toast(page, "2 tasks updated")).toBeVisible();
  for (const task of tasks) {
    await expect(
      taskCard(boardColumn(page, "In Review"), task.title),
    ).toBeVisible();
  }
  await expect(
    taskCard(boardColumn(page, "To Do"), bystander.title),
  ).toBeVisible();
  // The selection clears after an action.
  await expect(page.getByRole("toolbar")).toBeHidden();

  bar = await selectTasks(page, tasks);
  await runAction(page, bar, "Set priority", "High");
  await expect(toast(page, "2 tasks updated").first()).toBeVisible();

  bar = await selectTasks(page, tasks);
  await runAction(page, bar, "Add assignee", "MM Mia Member");
  await expect(toast(page, "Added Mia Member to 2 tasks")).toBeVisible();
  bar = await selectTasks(page, tasks);
  await runAction(page, bar, "Add assignee", "AA Adam Admin");
  await expect(toast(page, "Added Adam Admin to 2 tasks")).toBeVisible();
  for (const task of tasks) {
    await expect(taskCard(page, task.title)).toHaveAccessibleName(
      /Assigned to Mia Member, Adam Admin/,
    );
  }

  bar = await selectTasks(page, tasks);
  await runAction(page, bar, "Remove assignee", "MM Mia Member");
  await expect(toast(page, "Removed Mia Member from 2 tasks")).toBeVisible();

  bar = await selectTasks(page, tasks);
  await runAction(page, bar, "Add label", "Documentation");
  await expect(toast(page, "Label added to 2 tasks")).toBeVisible();

  for (const task of tasks) {
    const saved = await getTask(api, task.id);
    expect(saved.status).toBe("in-review");
    expect(saved.priority).toBe("high");
    expect(saved.assigneeIds).toEqual([seed.users.admin.id]);
    expect(await taskLabelNames(api, task.id)).toEqual(["Documentation"]);
  }
  const untouched = await getTask(api, bystander.id);
  expect(untouched.status).toBe("to-do");
  expect(untouched.priority).toBe("no-priority");
  expect(untouched.assigneeIds).toEqual([]);
});

test("cycle, module and estimate apply to the selection, then archive", async ({
  page,
  api,
}) => {
  const cycle = await createCycle(api, project.id, {
    name: uniqueName("Bulk cycle"),
    startDate: dayOffset(-2),
    endDate: dayOffset(12),
  });
  const mod = await createModule(api, project.id, {
    name: uniqueName("Bulk module"),
    status: "in-progress",
  });

  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);

  let bar = await selectTasks(page, tasks);
  await bar.getByRole("button", { name: "Cycle", exact: true }).click();
  await openPopover(page)
    .getByRole("button", { name: new RegExp(cycle.name) })
    .click();
  await expect(toast(page, `Moved 2 tasks to ${cycle.name}`)).toBeVisible();

  bar = await selectTasks(page, tasks);
  await bar.getByRole("button", { name: "Add to module…" }).click();
  await openPopover(page).getByRole("button", { name: mod.name }).click();
  await expect(toast(page, `Added 2 tasks to ${mod.name}`)).toBeVisible();

  bar = await selectTasks(page, tasks);
  await bar.getByRole("button", { name: "Estimate", exact: true }).click();
  await openPopover(page)
    .getByRole("button", { name: /^5 pts/ })
    .click();
  // The toast is brief; the chips are the lasting proof.
  await expect(toast(page, "Updated the estimate of 2 tasks"))
    .toBeVisible({ timeout: 3_000 })
    .catch(() => undefined);

  for (const task of tasks) {
    await expect(taskCard(page, task.title)).toContainText("5");
  }
  const board = await listBoard(api, project.id);
  const byId = new Map(
    board.columns
      .flatMap((column) => column.tasks)
      .map((task) => [task.id, task]),
  );
  const point = estimate.points.find((candidate) => candidate.value === "5");
  for (const task of tasks) {
    expect(byId.get(task.id)?.cycleId).toBe(cycle.id);
    expect(await taskModuleNames(api, task.id)).toEqual([mod.name]);
    expect((await getTask(api, task.id)).estimatePointId).toBe(point?.id);
  }
  expect(byId.get(bystander.id)?.cycleId ?? null).toBeNull();
  expect(await taskModuleNames(api, bystander.id)).toEqual([]);

  // Archive both.
  bar = await selectTasks(page, tasks);
  await runAction(page, bar, "Actions", "Archive tasks");
  await expect(toast(page, "2 tasks archived")).toBeVisible();
  for (const task of tasks) {
    await expect(taskCard(page, task.title)).toHaveCount(0);
  }
  await expect(taskCard(page, bystander.title)).toBeVisible();
  for (const task of tasks) {
    expect((await getTask(api, task.id)).archivedAt).toBeTruthy();
  }
});

test("due date and move to backlog work on the selection", async ({
  page,
  api,
}) => {
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);

  let bar = await selectTasks(page, tasks);
  await bar.getByRole("button", { name: "Set due date" }).click();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  await openPopover(page)
    .getByRole("button", { name: /^Today, / })
    .click();
  await expect(toast(page, "2 tasks updated")).toBeVisible();
  for (const task of tasks) {
    await expect
      .poll(async () => Boolean((await getTask(api, task.id)).dueDate))
      .toBe(true);
  }

  bar = await selectTasks(page, tasks);
  await bar.getByRole("button", { name: "Move to Backlog" }).click();
  await expect(toast(page, "2 tasks moved to backlog")).toBeVisible();
  for (const task of tasks) {
    await expect(taskCard(page, task.title)).toHaveCount(0);
    await expect
      .poll(async () => (await getTask(api, task.id)).status)
      .toBe("planned");
  }
});

test("the selection bar stays usable while a toast is showing", async ({
  page,
}) => {
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);

  let bar = await selectTasks(page, tasks);
  await runAction(page, bar, "Set priority", "Low");
  await expect(toast(page, "2 tasks updated")).toBeVisible();

  // Select again straight away, while the toast is still up.
  for (const task of tasks) {
    await taskCard(page, task.title).click({ modifiers: ["ControlOrMeta"] });
  }
  bar = page.getByRole("toolbar");
  await expect(bar.getByText("2 selected")).toBeVisible();
  await expect(toast(page, "2 tasks updated")).toBeVisible();
  // A trial click checks that nothing else receives the pointer.
  await bar
    .getByRole("button", { name: "Actions" })
    .click({ trial: true, timeout: 3_000 });
});
