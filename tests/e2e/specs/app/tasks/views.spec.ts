import { expect, test } from "../../../fixtures";
import {
  boardPath,
  createProject,
  createTask,
  deleteProject,
  getTask,
  isoDayOffset,
  listBoard,
  projectViewPath,
  type TestProject,
} from "../../../helpers/task-data";
import {
  boardColumn,
  createTaskDialog,
  dayLabel,
  dismissPopover,
  escapeRegExp,
  layoutTab,
  localDay,
  localYmd,
  openPopover,
  pickCalendarDay,
  restoreBoardLayout,
  shortDate,
  taskCard,
  taskSheet,
  waitForBoardReady,
  ymd,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

test.describe("list view", () => {
  test("rows open the task sheet and a group's add button creates in that status", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("List view") });
    const task = await createTask(api, project.id, {
      title: uniqueName("Listed task"),
      status: "in-review",
      priority: "high",
      dueDate: isoDayOffset(3),
    });

    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);
    await layoutTab(page, "List").click();

    const group = page.getByRole("button", {
      name: "In Review 1",
      exact: true,
    });
    await expect(group).toBeVisible();
    const row = taskCard(page, task.title);
    await expect(row).toContainText(`${project.slug}-${task.number}`);
    await expect(row).toContainText(shortDate(localDay(3)));

    await row.click();
    const sheet = taskSheet(page);
    await expect(
      sheet.getByRole("textbox", { name: "Click to add a title" }),
    ).toHaveValue(task.title);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // "Add task" next to the In Progress group creates an In Progress task.
    const inProgress = page.getByRole("button", {
      name: "In Progress 0",
      exact: true,
    });
    await inProgress
      .locator("xpath=following-sibling::button[1]")
      .or(
        inProgress
          .locator("xpath=..")
          .getByRole("button", { name: "Add task" }),
      )
      .first()
      .click();
    const dialog = createTaskDialog(page);
    await expect(
      dialog.getByText("In Progress", { exact: true }),
    ).toBeVisible();
    const title = uniqueName("From list");
    await dialog.getByPlaceholder("Task title").fill(title);
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(
      page.getByRole("button", { name: "In Progress 1", exact: true }),
    ).toBeVisible();
    await expect(taskCard(page, title)).toBeVisible();
    const created = (await listBoard(api, project.id)).columns
      .flatMap((column) => column.tasks)
      .find((candidate) => candidate.title === title);
    expect(created?.status).toBe("in-progress");
    await restoreBoardLayout(page);
  });
});

test.describe("backlog", () => {
  test("planned and archived sections, moving tasks to the board and Move All", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Backlog view") });
    const plannedA = await createTask(api, project.id, {
      title: uniqueName("Planned alpha"),
      status: "planned",
    });
    const plannedB = await createTask(api, project.id, {
      title: uniqueName("Planned beta"),
      status: "planned",
    });
    const plannedC = await createTask(api, project.id, {
      title: uniqueName("Planned gamma"),
      status: "planned",
    });
    const archived = await createTask(api, project.id, {
      title: uniqueName("Old archived"),
      status: "done",
    });
    await api.post(`/api/task/archive/${archived.id}`);
    const onBoard = await createTask(api, project.id, {
      title: uniqueName("Board only"),
    });

    await page.goto(projectViewPath(project.id, "backlog"));
    await expect(page.getByRole("button", { name: /^Planned 3/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: /^Archived 1/ }),
    ).toBeVisible();
    for (const task of [plannedA, plannedB, plannedC, archived]) {
      await expect(taskCard(page, task.title)).toBeVisible();
    }
    await expect(taskCard(page, onBoard.title)).toHaveCount(0);

    // A task planned from the backlog lands in Planned.
    const planned = uniqueName("Planned here");
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    const dialog = createTaskDialog(page);
    await dialog.getByPlaceholder("Task title").fill(planned);
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: /^Planned 4/ }),
    ).toBeVisible();
    await expect(taskCard(page, planned)).toBeVisible();

    // Move one planned task to the board through the selection bar.
    await taskCard(page, plannedA.title).click({
      modifiers: ["ControlOrMeta"],
    });
    await expect(page.getByText("1 selected")).toBeVisible();
    await page.getByRole("button", { name: "Move to board" }).click();
    await page.getByRole("menuitem", { name: "In Progress" }).click();
    await expect(
      page.getByRole("button", { name: /^Planned 3/ }),
    ).toBeVisible();
    await expect(taskCard(page, plannedA.title)).toHaveCount(0);
    await expect
      .poll(async () => (await getTask(api, plannedA.id)).status)
      .toBe("in-progress");

    // Move All sends the rest to the first open column after a confirmation.
    page.once("dialog", (confirm) => {
      expect(confirm.message()).toMatch(/^Move all 3 planned tasks to To Do\?/);
      void confirm.accept();
    });
    await page.getByRole("button", { name: "Move all" }).click();
    await expect(
      page.getByRole("button", { name: /^Planned 0/ }),
    ).toBeVisible();
    await expect(page.getByText("No planned tasks")).toBeVisible();
    // The archived task stays archived.
    await expect(
      page.getByRole("button", { name: /^Archived 1/ }),
    ).toBeVisible();

    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);
    const todo = boardColumn(page, "To Do");
    for (const title of [plannedB.title, plannedC.title, planned]) {
      await expect(taskCard(todo, title)).toBeVisible();
    }
    await expect(
      taskCard(boardColumn(page, "In Progress"), plannedA.title),
    ).toBeVisible();
    await expect(taskCard(page, archived.title)).toHaveCount(0);
  });

  test("a board card marked as planned moves to the backlog", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Backlog plan") });
    const task = await createTask(api, project.id, {
      title: uniqueName("Plan later"),
    });
    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);
    await taskCard(page, task.title).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Mark as planned" }).click();
    await expect(taskCard(page, task.title)).toHaveCount(0);
    await expect
      .poll(async () => (await getTask(api, task.id)).status)
      .toBe("planned");

    await page
      .getByRole("tab", { name: "Backlog", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/backlog/);
    await expect(
      page.getByRole("button", { name: /^Planned 1/ }),
    ).toBeVisible();
    await expect(taskCard(page, task.title)).toBeVisible();
  });
});

test.describe("calendar", () => {
  test("a task shows on its due date and follows a new date from the sheet", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Calendar view") });
    // Both days stay in the current month, which the calendar opens on.
    const today = localDay(0);
    const lastDay = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      0,
    ).getDate();
    const due = localDay(today.getDate() <= lastDay - 3 ? 1 : -3);
    const task = await createTask(api, project.id, {
      title: uniqueName("Calendar task"),
      dueDate: due.toISOString(),
    });
    const undated = await createTask(api, project.id, {
      title: uniqueName("No dates"),
    });

    await page.goto(projectViewPath(project.id, "calendar"));
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    const monthLabel = due.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    await expect(page.getByText(monthLabel, { exact: true })).toBeVisible();

    const bar = page.getByRole("button", {
      name: new RegExp(`^${escapeRegExp(task.title)}, `),
    });
    await expect(bar.first()).toBeVisible();
    await expect(bar.first()).toHaveAccessibleName(
      `${task.title}, ${shortDate(due)} – ${shortDate(due)}: open task`,
    );
    await expect(
      page.getByRole("button", {
        name: new RegExp(escapeRegExp(undated.title)),
      }),
    ).toHaveCount(0);

    // Open it and move the due date; the calendar follows.
    await bar.first().click();
    const sheet = taskSheet(page);
    await expect(
      sheet.getByRole("textbox", { name: "Click to add a title" }),
    ).toHaveValue(task.title);
    const moved = localDay(today.getDate() <= lastDay - 3 ? 3 : -1);
    await sheet
      .getByRole("button", { name: shortDate(due), exact: true })
      .click();
    await pickCalendarDay(openPopover(page), moved);
    await dismissPopover(
      page,
      sheet.getByRole("heading", { name: "Activity" }),
    );
    await expect
      .poll(async () => localYmd((await getTask(api, task.id)).dueDate))
      .toBe(ymd(moved));
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await expect(
      page
        .getByRole("button", {
          name: new RegExp(`^${escapeRegExp(task.title)}, `),
        })
        .first(),
    ).toHaveAccessibleName(
      `${task.title}, ${shortDate(moved)} – ${shortDate(moved)}: open task`,
    );
  });

  test("month navigation shows next month's tasks and Today comes back", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Calendar months") });
    const today = localDay(0);
    const nextMonthDay = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      15,
      12,
    );
    const later = await createTask(api, project.id, {
      title: uniqueName("Next month task"),
      dueDate: nextMonthDay.toISOString(),
    });
    await createTask(api, project.id, {
      title: uniqueName("This month task"),
      dueDate: today.toISOString(),
    });

    await page.goto(projectViewPath(project.id, "calendar"));
    const thisMonth = today.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    const nextMonth = nextMonthDay.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    await expect(page.getByText(thisMonth, { exact: true })).toBeVisible();
    const laterBar = page.getByRole("button", {
      name: new RegExp(`^${escapeRegExp(later.title)}, `),
    });
    await expect(laterBar).toHaveCount(0);

    await page.getByRole("button", { name: "Next month" }).click();
    await expect(page.getByText(nextMonth, { exact: true })).toBeVisible();
    await expect(laterBar).toBeVisible();
    await expect(laterBar).toHaveAccessibleName(
      `${later.title}, ${shortDate(nextMonthDay)} – ${shortDate(nextMonthDay)}: open task`,
    );

    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByText(thisMonth, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous month" }).click();
    const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12);
    await expect(
      page.getByText(
        previous.toLocaleString("en-US", { month: "long", year: "numeric" }),
        { exact: true },
      ),
    ).toBeVisible();
    void dayLabel;
  });
});

test.describe("gantt", () => {
  test("dated tasks get bars and the window pages through time", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Gantt view") });
    const current = await createTask(api, project.id, {
      title: uniqueName("Gantt now"),
      startDate: isoDayOffset(-1),
      dueDate: isoDayOffset(2),
    });
    // Far apart, so the timeline needs more than one 91-day window.
    const early = await createTask(api, project.id, {
      title: uniqueName("Gantt early"),
      startDate: isoDayOffset(-80),
      dueDate: isoDayOffset(-75),
    });
    const late = await createTask(api, project.id, {
      title: uniqueName("Gantt late"),
      startDate: isoDayOffset(120),
      dueDate: isoDayOffset(125),
    });
    const undated = await createTask(api, project.id, {
      title: uniqueName("Gantt undated"),
    });

    await page.goto(projectViewPath(project.id, "gantt"));
    await expect(
      page.getByRole("heading", { name: "Gantt timeline" }),
    ).toBeVisible();

    const barFor = (title: string) =>
      page.getByRole("button", {
        name: `${title}: open or drag to move`,
      });
    const railRow = (title: string) =>
      page
        .getByRole("button", { name: new RegExp(escapeRegExp(title)) })
        .first();

    // Every dated task has a row; the undated one is listed under No dates,
    // without a bar.
    for (const task of [current, early, late]) {
      await expect(railRow(task.title)).toBeVisible();
    }
    await expect(
      page.getByRole("region", { name: "No dates" }).getByText(undated.title),
    ).toBeVisible();
    await expect(barFor(undated.title)).toHaveCount(0);
    await expect(barFor(current.title)).toBeVisible();

    const start = page.getByRole("textbox", { name: "Timeline start date" });
    const initialStart = await start.inputValue();
    const next = page.getByRole("button", { name: "Next period" });
    const previous = page.getByRole("button", { name: "Previous period" });

    await expect(next).toBeEnabled();
    await next.click();
    await expect(start).not.toHaveValue(initialStart);
    const afterNext = await start.inputValue();
    expect(afterNext > initialStart).toBe(true);
    await expect(barFor(late.title)).toBeVisible();

    await expect(previous).toBeEnabled();
    await previous.click();
    await expect(start).not.toHaveValue(afterNext);

    // Typing a start date jumps there.
    const earlyStart = localDay(-84);
    await start.fill(ymd(earlyStart));
    await start.press("Enter");
    await expect(barFor(early.title)).toBeVisible();

    await page.getByRole("button", { name: "Jump to today" }).click();
    await expect(barFor(current.title)).toBeInViewport();

    // Searching narrows the rows.
    await page.getByPlaceholder("Search tasks...").fill(late.title);
    await expect(railRow(late.title)).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: new RegExp(escapeRegExp(current.title)),
      }),
    ).toHaveCount(0);
  });

  test("dragging a bar moves both dates", async ({ page, api }) => {
    project = await createProject(api, { name: uniqueName("Gantt drag") });
    const task = await createTask(api, project.id, {
      title: uniqueName("Drag bar"),
      startDate: isoDayOffset(0),
      dueDate: isoDayOffset(3),
    });

    await page.goto(projectViewPath(project.id, "gantt"));
    const bar = page.getByRole("button", {
      name: `${task.title}: open or drag to move`,
    });
    // The first paint of a project view waits on a cold dev server.
    await expect(bar).toBeVisible({ timeout: 30_000 });
    // Until the task:update check resolves, pressing the bar only opens the
    // task; the resize handles turn enabled at the same moment.
    await expect(
      page.getByRole("button", { name: "Resize due date" }),
    ).toBeEnabled({ timeout: 30_000 });
    await bar.scrollIntoViewIfNeeded();
    const box = await bar.boundingBox();
    if (!box) throw new Error("the bar is not visible");
    // The bar spans four days.
    const dayWidth = box.width / 4;
    const y = box.y + box.height / 2;
    const x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dayWidth, y, { steps: 5 });
    await page.mouse.move(x + dayWidth * 2, y, { steps: 5 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const saved = await getTask(api, task.id);
        return [localYmd(saved.startDate), localYmd(saved.dueDate)];
      })
      .toEqual([ymd(localDay(2)), ymd(localDay(5))]);
  });
});
