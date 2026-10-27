import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { readJson } from "../../../helpers/http";
import {
  addTasksToCycle,
  backdateCycle,
  boardPath,
  createCycle,
  createProject,
  createTask,
  dayOffset,
  deleteProject,
  listBoard,
  projectSettingsPath,
  projectViewPath,
  setProjectFeatures,
  type TestProject,
  taskPagePath,
} from "../../../helpers/task-data";
import {
  boardColumn,
  dayLabel,
  localDay,
  openPopover,
  openTaskPage,
  taskCard,
  taskSheet,
  toast,
  toolbarButton,
  waitForBoardReady,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

type Cycle = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  archivedAt: string | null;
};

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, {
    name: uniqueName("Cycles"),
    features: { cyclesEnabled: true },
  });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

async function listCycles(
  api: APIRequestContext,
  view: "all" | "archived" = "all",
) {
  return readJson<Cycle[]>(
    await api.get(`/api/cycle/project/${project.id}`, { params: { view } }),
    "list cycles",
  );
}

function cyclePath(cycleId: string) {
  return `${projectViewPath(project.id, "cycles")}/${cycleId}`;
}

/** Opens a cycle page; ready once its details panel and actions render. */
async function openCyclePage(page: Page, cycleId: string) {
  await page.goto(cyclePath(cycleId));
  await expect(page.getByRole("button", { name: "Cycle actions" })).toBeVisible(
    {
      timeout: 30_000,
    },
  );
  await expect(
    page.getByRole("complementary", { name: "Cycle details" }),
  ).toBeVisible();
}

async function pickRange(page: Page, from: Date, to: Date) {
  const calendar = openPopover(page);
  for (const day of [from, to]) {
    const button = calendar.getByRole("button", { name: dayLabel(day) });
    if (!(await button.isVisible())) {
      await calendar.getByRole("button", { name: /next month/i }).click();
    }
    await button.click();
  }
}

test("the feature switch shows and hides the Cycles section", async ({
  page,
  api,
}) => {
  await setProjectFeatures(api, project.id, { cyclesEnabled: false });
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);
  const tab = page
    .getByRole("navigation", { name: "Project sections" })
    .getByRole("tab", { name: "Cycles" });
  await expect(tab).toHaveCount(0);

  await page.goto(projectSettingsPath(project.id, "features"));
  const toggle = page.getByRole("switch", { name: "Cycles" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toast(page, "Cycles turned on")).toBeVisible();
  await expect(toggle).toBeChecked();

  await page.goto(boardPath(project.id));
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page).toHaveURL(/\/cycles$/);
  await expect(page.getByText("Plan work in cycles")).toBeVisible();
});

test("a cycle is created with dates and an overlapping one is refused", async ({
  page,
  api,
}) => {
  await page.goto(projectViewPath(project.id, "cycles"));
  await expect(page.getByText("Plan work in cycles")).toBeVisible({
    timeout: 30_000,
  });

  const start = localDay(0);
  const end = localDay(13);
  await page.getByRole("button", { name: "New cycle" }).first().click();
  let dialog = page.getByRole("dialog", { name: "New cycle" });
  await dialog.getByLabel("Name").fill("Sprint A");
  await dialog.getByLabel("Description").fill("The first sprint.");
  await dialog.getByRole("button", { name: "Dates", exact: true }).click();
  await pickRange(page, start, end);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Create cycle" }).click();
  await expect(toast(page, "Cycle created")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: "Sprint A" })).toBeVisible();

  // A second cycle may not overlap the first.
  await page.getByRole("button", { name: "New cycle" }).first().click();
  dialog = page.getByRole("dialog", { name: "New cycle" });
  await dialog.getByLabel("Name").fill("Sprint B");
  await dialog.getByRole("button", { name: "Dates", exact: true }).click();
  await pickRange(page, localDay(5), localDay(9));
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Create cycle" }).click();
  await expect(
    dialog.getByText(
      "These dates overlap with “Sprint A”. Choose other dates or save it as a draft.",
    ),
  ).toBeVisible();
  await expect(dialog).toBeVisible();

  // Clear the dates and pick a free range instead.
  await dialog.getByRole("button", { name: "Clear dates" }).click();
  await dialog.getByRole("button", { name: "Dates", exact: true }).click();
  await pickRange(page, localDay(14), localDay(20));
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Create cycle" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: "Sprint B" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Upcoming/ })).toBeVisible();

  const cycles = await listCycles(api);
  const byName = new Map(cycles.map((cycle) => [cycle.name, cycle]));
  expect(byName.get("Sprint A")).toMatchObject({
    startDate: dayOffset(0),
    endDate: dayOffset(13),
    status: "current",
  });
  expect(byName.get("Sprint B")).toMatchObject({
    startDate: dayOffset(14),
    endDate: dayOffset(20),
    status: "upcoming",
  });
});

test("tasks join a cycle from the task picker and the Add existing dialog", async ({
  page,
  api,
}) => {
  const cycle = await createCycle(api, project.id, {
    name: "Sprint Pick",
    startDate: dayOffset(-2),
    endDate: dayOffset(10),
  });
  const viaPicker = await createTask(api, project.id, {
    title: uniqueName("Via picker"),
  });
  const viaDialog = await createTask(api, project.id, {
    title: uniqueName("Via dialog"),
  });
  const outside = await createTask(api, project.id, {
    title: uniqueName("Stays out"),
  });

  // Sidebar picker on the task page.
  await openTaskPage(page, taskPagePath(project.id, viaPicker.id));
  await page.getByRole("button", { name: "No cycle" }).click();
  await openPopover(page)
    .getByRole("button", { name: /Sprint Pick/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Sprint Pick", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("added the task to cycle Sprint Pick"),
  ).toBeVisible();

  // "Add existing" on the cycle page.
  await openCyclePage(page, cycle.id);
  await expect(taskCard(page, viaPicker.title)).toBeVisible();
  await page.getByRole("button", { name: "Add existing" }).click();
  const dialog = page.getByRole("dialog", { name: "Add existing tasks" });
  await dialog
    .getByPlaceholder("Search tasks by key or title")
    .fill(viaDialog.title);
  await dialog
    .getByRole("button", { name: new RegExp(viaDialog.title) })
    .click();
  await dialog.getByRole("button", { name: "Add 1 task" }).click();
  await expect(toast(page, "Added 1 task to Sprint Pick")).toBeVisible();
  await expect(taskCard(page, viaDialog.title)).toBeVisible();
  await expect(taskCard(page, outside.title)).toHaveCount(0);
  await expect(
    page.getByText("2 tasks", { exact: true }).first(),
  ).toBeVisible();

  const board = await listBoard(api, project.id);
  const cycleOf = new Map(
    board.columns
      .flatMap((column) => column.tasks)
      .map((task) => [task.id, task.cycleId]),
  );
  expect(cycleOf.get(viaPicker.id)).toBe(cycle.id);
  expect(cycleOf.get(viaDialog.id)).toBe(cycle.id);
  expect(cycleOf.get(outside.id) ?? null).toBeNull();

  // The project board shows the cycle chip on member cards.
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);
  await expect(taskCard(page, viaPicker.title)).toContainText("Sprint Pick");
  await expect(taskCard(page, outside.title)).not.toContainText("Sprint Pick");
});

test("the cycle page switches layouts and its progress follows completed work", async ({
  page,
  api,
}) => {
  const cycle = await createCycle(api, project.id, {
    name: "Sprint Run",
    startDate: dayOffset(-3),
    endDate: dayOffset(10),
  });
  const first = await createTask(api, project.id, {
    title: uniqueName("Run first"),
  });
  const second = await createTask(api, project.id, {
    title: uniqueName("Run second"),
  });
  await addTasksToCycle(api, cycle.id, [first.id, second.id]);

  await openCyclePage(page, cycle.id);
  const details = page.getByRole("complementary", { name: "Cycle details" });
  await expect(
    details.getByRole("heading", { name: "Sprint Run" }),
  ).toBeVisible();
  await expect(details.getByText("0%", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("img", {
      name: /^2 of 2 tasks left, \d+ days remaining/,
    }),
  ).toBeVisible();
  await expect(
    details.getByRole("button", { name: "Burn-down" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Board and list layouts on the cycle page.
  await expect(taskCard(boardColumn(page, "To Do"), first.title)).toBeVisible();
  await toolbarButton(page, "List").click();
  await expect(
    page.getByRole("button", { name: "To Do 2", exact: true }),
  ).toBeVisible();
  await toolbarButton(page, "Board").click();
  await expect(
    taskCard(boardColumn(page, "To Do"), second.title),
  ).toBeVisible();

  // Work finished elsewhere (another member, the API) reaches the open page.
  await api.put(`/api/task/status/${first.id}`, { data: { status: "done" } });
  await expect(details.getByText("50%", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("img", { name: /^1 of 2 tasks left/ }),
  ).toBeVisible();
  await expect(taskCard(boardColumn(page, "Done"), first.title)).toBeVisible();

  await details.getByRole("button", { name: "Burn-up" }).click();
  await expect(
    details.getByRole("button", { name: "Burn-up" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    details.getByRole("button", { name: "Burn-down" }),
  ).toHaveAttribute("aria-pressed", "false");

  // The cycles list shows the same progress.
  await page.goto(projectViewPath(project.id, "cycles"));
  await expect(page.getByText("50% complete")).toBeVisible();
  await expect(page.getByText("1/2 done")).toBeVisible();
});

test("completing a task from the sheet on the cycle page updates its progress", async ({
  page,
  api,
}) => {
  const cycle = await createCycle(api, project.id, {
    name: "Sprint Live",
    startDate: dayOffset(-3),
    endDate: dayOffset(10),
  });
  const first = await createTask(api, project.id, {
    title: uniqueName("Live first"),
  });
  const second = await createTask(api, project.id, {
    title: uniqueName("Live second"),
  });
  await addTasksToCycle(api, cycle.id, [first.id, second.id]);

  await openCyclePage(page, cycle.id);
  const details = page.getByRole("complementary", { name: "Cycle details" });
  await expect(details.getByText("0%", { exact: true })).toBeVisible();

  await taskCard(page, first.title).click();
  const sheet = taskSheet(page);
  await sheet.getByRole("button", { name: "To Do", exact: true }).click();
  await openPopover(page).getByRole("button", { name: /^Done/ }).click();
  await expect(
    sheet.getByRole("button", { name: "Done", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await expect(details.getByText("50%", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("img", { name: /^1 of 2 tasks left/ }),
  ).toBeVisible();
});

test("unfinished tasks transfer from a completed cycle to another cycle", async ({
  page,
  api,
}) => {
  const old = await createCycle(api, project.id, {
    name: "Sprint Old",
    startDate: dayOffset(-5),
    endDate: dayOffset(3),
  });
  const next = await createCycle(api, project.id, {
    name: "Sprint Next",
    startDate: dayOffset(4),
    endDate: dayOffset(18),
  });
  const done = await createTask(api, project.id, {
    title: uniqueName("Finished"),
    status: "done",
  });
  const open1 = await createTask(api, project.id, {
    title: uniqueName("Unfinished one"),
  });
  const open2 = await createTask(api, project.id, {
    title: uniqueName("Unfinished two"),
    status: "in-progress",
  });
  await addTasksToCycle(api, old.id, [done.id, open1.id, open2.id]);
  await backdateCycle(old.id, dayOffset(-20), dayOffset(-6));

  await openCyclePage(page, old.id);
  await expect(
    page.getByText("2 tasks weren't finished in this cycle."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Transfer tasks" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Transfer 2 unfinished tasks",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Sprint Next/ }).click();
  await expect(toast(page, "Moved 2 tasks to Sprint Next")).toBeVisible();

  const board = await listBoard(api, project.id);
  const cycleOf = new Map(
    board.columns
      .flatMap((column) => column.tasks)
      .map((task) => [task.id, task.cycleId]),
  );
  expect(cycleOf.get(open1.id)).toBe(next.id);
  expect(cycleOf.get(open2.id)).toBe(next.id);
  expect(cycleOf.get(done.id)).toBe(old.id);

  await openCyclePage(page, next.id);
  await expect(taskCard(page, open1.title)).toBeVisible();
  await expect(taskCard(page, open2.title)).toBeVisible();
  await expect(taskCard(page, done.title)).toHaveCount(0);
});

test("a completed cycle is archived and restored", async ({ page, api }) => {
  const cycle = await createCycle(api, project.id, {
    name: "Sprint Past",
    startDate: dayOffset(-3),
    endDate: dayOffset(2),
  });
  const task = await createTask(api, project.id, {
    title: uniqueName("Past work"),
    status: "done",
  });
  await addTasksToCycle(api, cycle.id, [task.id]);
  await backdateCycle(cycle.id, dayOffset(-15), dayOffset(-8));

  await page.goto(projectViewPath(project.id, "cycles"));
  await expect(page.getByRole("link", { name: "Sprint Past" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Cycle actions" }).first().click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(toast(page, "Cycle archived")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sprint Past" })).toHaveCount(0);
  expect((await listCycles(api, "archived")).map((c) => c.name)).toEqual([
    "Sprint Past",
  ]);

  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sprint Past" })).toBeVisible();
  await page.getByRole("button", { name: "Cycle actions" }).first().click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await expect(toast(page, "Cycle restored")).toBeVisible();
  await expect(page.getByText("No archived cycles")).toBeVisible();
  await page.locator('[data-slot="toggle"]', { hasText: /^Cycles$/ }).click();
  await expect(page.getByRole("link", { name: "Sprint Past" })).toBeVisible();
  expect(await listCycles(api, "archived")).toEqual([]);
});

test("a running cycle cannot be archived", async ({ page, api }) => {
  await createCycle(api, project.id, {
    name: "Sprint Live",
    startDate: dayOffset(-1),
    endDate: dayOffset(6),
  });
  await page.goto(projectViewPath(project.id, "cycles"));
  await page.getByRole("button", { name: "Cycle actions" }).first().click();
  await expect(page.getByRole("menuitem", { name: /^Archive/ })).toBeDisabled();
});

test("a cycle is added to and removed from favorites", async ({
  page,
  api,
  seed,
}) => {
  const cycle = await createCycle(api, project.id, {
    name: "Sprint Fav",
    startDate: dayOffset(0),
    endDate: dayOffset(7),
  });
  await openCyclePage(page, cycle.id);

  // The cycle's star is the first favorites button after "Toggle cycle
  // details" (the project has one too; the retrospective button sits between).
  const star = page
    .getByRole("button", { name: "Toggle cycle details" })
    .locator("xpath=following::button[contains(@aria-label, 'favorites')][1]");
  await expect(star).toHaveAccessibleName("Add to favorites");
  await star.click();
  await expect(toast(page, "Added to favorites")).toBeVisible();
  await expect(star).toHaveAccessibleName("Remove from favorites");
  await expect(star).toHaveAttribute("aria-pressed", "true");

  const favorites = async () =>
    (
      await readJson<{ entityId: string; entityType: string }[]>(
        await api.get("/api/favorite", {
          params: { workspaceId: seed.workspace.id },
        }),
        "list favorites",
      )
    ).filter((favorite) => favorite.entityId === cycle.id);
  await expect.poll(async () => (await favorites()).length).toBe(1);

  await star.click();
  await expect(toast(page, "Removed from favorites")).toBeVisible();
  await expect(star).toHaveAccessibleName("Add to favorites");
  await expect.poll(async () => (await favorites()).length).toBe(0);
});

test("the split-view planner moves tasks into and out of a cycle", async ({
  page,
  api,
}) => {
  const cycle = await createCycle(api, project.id, {
    name: "Sprint Plan",
    startDate: dayOffset(0),
    endDate: dayOffset(10),
  });
  const planned = await createTask(api, project.id, {
    title: uniqueName("Already planned"),
  });
  const urgent = await createTask(api, project.id, {
    title: uniqueName("Urgent pick"),
    priority: "urgent",
  });
  const low = await createTask(api, project.id, {
    title: uniqueName("Low pick"),
    priority: "low",
  });
  await addTasksToCycle(api, cycle.id, [planned.id]);

  await openCyclePage(page, cycle.id);
  await page.getByRole("button", { name: "Plan cycle" }).click();
  await expect(page).toHaveURL(/mode=plan/);
  const backlog = page.getByRole("region", { name: "Backlog" });
  const sprint = page.getByRole("region", { name: "Sprint Plan" });
  const row = (pane: typeof backlog, title: string) =>
    pane.getByRole("button", { name: new RegExp(title) });

  // The backlog is sorted by priority and offers only unplanned work.
  await expect(row(backlog, urgent.title)).toBeVisible({ timeout: 30_000 });
  await expect(row(sprint, planned.title)).toBeVisible();
  await expect(row(backlog, planned.title)).toHaveCount(0);
  const backlogTitles = await backlog
    .getByRole("button", { name: /^Add / })
    .allTextContents();
  expect(
    backlogTitles.findIndex((text) => text.includes(urgent.title)),
  ).toBeLessThan(backlogTitles.findIndex((text) => text.includes(low.title)));

  // Space adds the focused task; the keyboard stays in the backlog.
  await row(backlog, urgent.title).focus();
  await page.keyboard.press("Space");
  await expect(row(sprint, urgent.title)).toBeVisible();
  await expect(row(backlog, urgent.title)).toHaveCount(0);
  await expect(sprint.getByText("2 tasks planned")).toBeVisible();

  // A click takes a task back out.
  await row(sprint, planned.title).click();
  await expect(row(backlog, planned.title)).toBeVisible();

  const cycleOf = async () => {
    const board = await listBoard(api, project.id);
    return new Map(
      [...board.columns.flatMap((column) => column.tasks)].map((task) => [
        task.id,
        task.cycleId ?? null,
      ]),
    );
  };
  await expect
    .poll(async () => (await cycleOf()).get(urgent.id))
    .toBe(cycle.id);
  await expect.poll(async () => (await cycleOf()).get(planned.id)).toBeNull();

  // Back to the board shows the cycle's tasks.
  await page.getByRole("button", { name: "Back to board" }).click();
  await expect(page).not.toHaveURL(/mode=plan/);
  await expect(taskCard(page, urgent.title)).toBeVisible();
});
