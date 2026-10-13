import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { readJson } from "../../../helpers/http";
import {
  addTasksToCycle,
  boardPath,
  createCycle,
  createEstimate,
  createProject,
  createTask,
  dayOffset,
  deleteProject,
  getTask,
  projectSettingsPath,
  projectViewPath,
  setTaskEstimate,
  type TestEstimate,
  type TestProject,
} from "../../../helpers/task-data";
import {
  boardColumn,
  openDisplayMenu,
  openPopover,
  taskCard,
  taskSheet,
  titlesInOrder,
  toast,
  waitForBoardReady,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

type EstimateList = {
  activeEstimateId: string | null;
  estimates: (TestEstimate & { points: { id: string; value: string }[] })[];
};

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, {
    name: uniqueName("Estimates"),
    features: { estimatesEnabled: true, cyclesEnabled: true },
  });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

async function listEstimates(api: APIRequestContext) {
  return readJson<EstimateList>(
    await api.get(`/api/estimate/${project.id}`),
    "list estimates",
  );
}

function pointId(estimate: TestEstimate, value: string) {
  const point = estimate.points.find((candidate) => candidate.value === value);
  if (!point) throw new Error(`no point ${value}`);
  return point.id;
}

test("a points system is created in settings and set active", async ({
  page,
  api,
}) => {
  await page.goto(projectSettingsPath(project.id, "estimates"));
  await expect(page.getByText("No estimate system yet")).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Add estimate system" }).click();
  let dialog = page.getByRole("dialog", { name: "New estimate system" });
  await expect(dialog.getByRole("radio", { name: "Points" })).toBeChecked();
  await dialog.getByRole("button", { name: /^Fibonacci/ }).click();
  await expect(dialog.getByLabel("Name")).toHaveValue("Fibonacci");
  await dialog.getByLabel("Name").fill("Story size");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(toast(page, "Estimate system created")).toBeVisible();
  await expect(dialog).toBeHidden();

  // The first system becomes the active one.
  await expect(
    page.getByRole("heading", { name: "Estimate system", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Story size",
  );
  for (const value of ["1", "2", "3", "5", "8", "13"]) {
    await expect(
      page.getByRole("textbox", { name: `Edit ${value}`, exact: true }),
    ).toHaveValue(value);
  }
  let list = await listEstimates(api);
  const story = list.estimates.find(
    (estimate) => estimate.name === "Story size",
  );
  expect(list.activeEstimateId).toBe(story?.id);

  // A second system is created and switched to.
  await page.getByRole("button", { name: "Estimate system actions" }).click();
  await page.getByRole("menuitem", { name: "New system" }).click();
  dialog = page.getByRole("dialog", { name: "New estimate system" });
  await dialog.getByRole("button", { name: /^Linear/ }).click();
  await dialog.getByLabel("Name").fill("Linear size");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(toast(page, "Estimate system created")).toBeVisible();

  let switchDialog = page.getByRole("dialog", {
    name: "Switch estimate system",
  });
  await expect(switchDialog).toBeVisible();
  await expect(
    switchDialog.getByText("No tasks have an estimate yet."),
  ).toBeVisible();
  await switchDialog
    .getByRole("button", { name: "Switch", exact: true })
    .click();
  await expect(toast(page, "Estimate system switched")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name" }).first()).toHaveValue(
    "Linear size",
  );
  await expect(
    page.getByRole("heading", { name: "Other estimate systems" }),
  ).toBeVisible();

  // "Use this system" brings the first one back.
  await page.getByRole("button", { name: "Use this system" }).click();
  switchDialog = page.getByRole("dialog", { name: "Switch estimate system" });
  await switchDialog
    .getByRole("button", { name: "Switch", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Name" }).first()).toHaveValue(
    "Story size",
  );
  list = await listEstimates(api);
  expect(list.activeEstimateId).toBe(story?.id);
});

test("an estimate set in the sidebar shows on the card and sorts the board", async ({
  page,
  api,
}) => {
  const estimate = await createEstimate(api, project.id, {
    name: "Points",
    type: "points",
    values: ["1", "2", "3", "5", "8"],
  });
  const suffix = uniqueName("e");
  const five = await createTask(api, project.id, { title: `Five ${suffix}` });
  const eight = await createTask(api, project.id, { title: `Eight ${suffix}` });
  const one = await createTask(api, project.id, { title: `One ${suffix}` });
  const none = await createTask(api, project.id, { title: `None ${suffix}` });
  await setTaskEstimate(api, eight.id, pointId(estimate, "8"));
  await setTaskEstimate(api, one.id, pointId(estimate, "1"));

  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);
  await taskCard(page, five.title).click();
  const sheet = taskSheet(page);
  await sheet.getByRole("button", { name: "No estimate" }).click();
  await openPopover(page)
    .getByRole("button", { name: /^5 pts/ })
    .click();
  await expect(sheet.getByRole("button", { name: "5 pts" })).toBeVisible();
  await expect
    .poll(async () => (await getTask(api, five.id)).estimatePointId)
    .toBe(pointId(estimate, "5"));
  await expect(sheet.getByText("set the estimate to 5 pts")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Card chips.
  await expect(
    taskCard(page, five.title).getByTitle("Estimate: 5"),
  ).toBeVisible();
  await expect(
    taskCard(page, eight.title).getByTitle("Estimate: 8"),
  ).toBeVisible();
  await expect(taskCard(page, none.title).getByTitle(/^Estimate:/)).toHaveCount(
    0,
  );

  // Order by estimate: largest first, tasks without one last.
  const titles = [five.title, eight.title, one.title, none.title];
  const order = () => titlesInOrder(boardColumn(page, "To Do"), titles);
  const display = await openDisplayMenu(page);
  const orderBy = display
    .getByText("Order by", { exact: true })
    .locator("xpath=following::*[@role='combobox'][1]");
  await orderBy.click();
  await page.getByRole("option", { name: "Estimate" }).click();
  await expect
    .poll(order)
    .toEqual([eight.title, five.title, one.title, none.title]);
  await display.getByRole("button", { name: /Ascending|Descending/ }).click();
  await expect
    .poll(order)
    .toEqual([one.title, five.title, eight.title, none.title]);
});

test("the cycle burn chart switches between tasks and points", async ({
  page,
  api,
}) => {
  const estimate = await createEstimate(api, project.id, {
    name: "Points",
    type: "points",
    values: ["1", "2", "3", "5", "8"],
  });
  const cycle = await createCycle(api, project.id, {
    name: "Sprint Points",
    startDate: dayOffset(-2),
    endDate: dayOffset(10),
  });
  const done = await createTask(api, project.id, {
    title: uniqueName("Done three"),
    status: "done",
    estimatePointId: pointId(estimate, "3"),
  });
  const open = await createTask(api, project.id, {
    title: uniqueName("Open five"),
    estimatePointId: pointId(estimate, "5"),
  });
  await addTasksToCycle(api, cycle.id, [done.id, open.id]);

  await page.goto(`${projectViewPath(project.id, "cycles")}/${cycle.id}`);
  const details = page.getByRole("complementary", { name: "Cycle details" });
  await expect(
    details.getByRole("heading", { name: "Sprint Points" }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(details.getByText("3 / 8 pts").first()).toBeVisible();
  await expect(details.getByText("2 of 2 tasks estimated")).toBeVisible();

  const unit = details.getByRole("group", { name: "Chart unit" });
  await expect(unit.getByRole("button", { name: "Tasks" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    details.getByRole("img", { name: /^1 of 2 tasks left/ }),
  ).toBeVisible();

  await unit.getByRole("button", { name: "Points" }).click();
  await expect(unit.getByRole("button", { name: "Points" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    details.getByRole("img", {
      name: /^5 of 8 points left, \d+ days remaining/,
    }),
  ).toBeVisible();

  await unit.getByRole("button", { name: "Tasks" }).click();
  await expect(
    details.getByRole("img", { name: /^1 of 2 tasks left/ }),
  ).toBeVisible();
});

test("deleting a value in use moves its tasks or clears their estimate", async ({
  page,
  api,
}) => {
  const estimate = await createEstimate(api, project.id, {
    name: "Points",
    type: "points",
    values: ["1", "2", "3", "5", "8"],
  });
  const threeA = await createTask(api, project.id, {
    title: uniqueName("Three A"),
    estimatePointId: pointId(estimate, "3"),
  });
  const threeB = await createTask(api, project.id, {
    title: uniqueName("Three B"),
    estimatePointId: pointId(estimate, "3"),
  });
  const eight = await createTask(api, project.id, {
    title: uniqueName("Eight"),
    estimatePointId: pointId(estimate, "8"),
  });

  await page.goto(projectSettingsPath(project.id, "estimates"));
  const threeRow = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("textbox", { name: "Edit 3" }) });
  await expect(threeRow).toContainText("2 tasks", { timeout: 30_000 });

  // Move the two tasks on 3 to 5.
  await threeRow.getByRole("button", { name: "Delete 3" }).click();
  let confirm = page.getByRole("alertdialog", { name: "Delete 3 pts?" });
  await expect(confirm).toContainText("2 tasks use this estimate.");
  await confirm.getByRole("combobox", { name: "Move them to" }).click();
  await page.getByRole("option", { name: "5 pts" }).click();
  await confirm.getByRole("button", { name: "Delete value" }).click();
  await expect(toast(page, "Estimate value deleted")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Edit 3" })).toHaveCount(0);
  await expect(
    page
      .getByRole("listitem")
      .filter({ has: page.getByRole("textbox", { name: "Edit 5" }) }),
  ).toContainText("2 tasks");
  for (const task of [threeA, threeB]) {
    expect((await getTask(api, task.id)).estimatePointId).toBe(
      pointId(estimate, "5"),
    );
  }

  // Clear the estimate of the task on 8.
  await page.getByRole("button", { name: "Delete 8" }).click();
  confirm = page.getByRole("alertdialog", { name: "Delete 8 pts?" });
  await expect(confirm).toContainText("1 task uses this estimate.");
  await confirm.getByRole("combobox", { name: "Move them to" }).click();
  await page.getByRole("option", { name: "Clear their estimate" }).click();
  await confirm.getByRole("button", { name: "Delete value" }).click();
  await expect(page.getByRole("textbox", { name: "Edit 8" })).toHaveCount(0);
  await expect
    .poll(async () => (await getTask(api, eight.id)).estimatePointId ?? null)
    .toBeNull();

  // A value nobody uses goes at once.
  await page.getByRole("button", { name: "Delete 1" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Edit 1" })).toHaveCount(0);
  const list = await listEstimates(api);
  const values = list.estimates
    .find((candidate) => candidate.id === estimate.id)
    ?.points.map((point) => point.value);
  expect(values).toEqual(["2", "5"]);
});
