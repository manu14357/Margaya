import type { Locator } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import {
  addLabelToTask,
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
  type TestProject,
  taskAssigneeIds,
  taskLabelNames,
  taskModuleNames,
} from "../../../helpers/task-data";
import {
  boardColumn,
  closeMenus,
  createTaskDialog,
  dragAndDrop,
  escapeRegExp,
  fillRichText,
  localDay,
  localYmd,
  openDisplayMenu,
  openFilterSubmenu,
  openPopover,
  pickCalendarDay,
  restoreBoardLayout,
  shortDate,
  taskCard,
  titlesInOrder,
  toolbarButton,
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

test.describe("creating tasks", () => {
  test("a column's add button creates the task in that column", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Board create") });
    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);

    const title = uniqueName("From column");
    await boardColumn(page, "In Progress")
      .getByRole("button", { name: "Add task" })
      .click();
    const dialog = createTaskDialog(page);
    await expect(dialog.getByPlaceholder("Task title")).toBeVisible();
    // The modal shows the column it creates in.
    await expect(
      dialog.getByText("In Progress", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Create task" }),
    ).toBeDisabled();
    await dialog.getByPlaceholder("Task title").fill(title);
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(dialog).toBeHidden();

    await expect(
      taskCard(boardColumn(page, "In Progress"), title),
    ).toBeVisible();
    await expect(taskCard(boardColumn(page, "To Do"), title)).toHaveCount(0);

    const board = await listBoard(api, project.id);
    const created = board.columns
      .flatMap((column) => column.tasks)
      .find((task) => task.title === title);
    expect(created?.status).toBe("in-progress");
  });

  test("the create modal sets every property of a new task", async ({
    page,
    api,
    seed,
  }) => {
    project = await createProject(api, {
      name: uniqueName("Board modal"),
      features: {
        cyclesEnabled: true,
        modulesEnabled: true,
        estimatesEnabled: true,
      },
    });
    const estimate = await createEstimate(api, project.id, {
      name: "Points",
      type: "points",
      values: ["1", "2", "3", "5"],
    });
    const cycle = await createCycle(api, project.id, {
      name: uniqueName("Cycle"),
      startDate: dayOffset(-1),
      endDate: dayOffset(12),
    });
    const mod = await createModule(api, project.id, {
      name: uniqueName("Module"),
      status: "planned",
    });

    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);

    const title = uniqueName("Full task");
    const start = localDay(0);
    const due = localDay(5);

    await boardColumn(page, "To Do")
      .getByRole("button", { name: "Add task" })
      .click();
    const dialog = createTaskDialog(page);
    await dialog.getByPlaceholder("Task title").fill(title);

    await dialog.getByRole("button", { name: "Start date" }).click();
    await pickCalendarDay(openPopover(page), start);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "No priority" }).click();
    await openPopover(page).getByRole("button", { name: "High" }).click();
    await expect(dialog.getByRole("button", { name: "High" })).toBeVisible();

    await dialog.getByRole("button", { name: "Assign" }).click();
    const people = openPopover(page);
    await people.getByRole("menuitemcheckbox", { name: /Mia Member/ }).click();
    await people.getByRole("menuitemcheckbox", { name: /Adam Admin/ }).click();
    await expect(
      people.getByRole("menuitemcheckbox", { name: /Adam Admin/ }),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(
      dialog.getByRole("button", { name: /Mia Member \+1/ }),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Due date" }).click();
    await pickCalendarDay(openPopover(page), due);
    await page.keyboard.press("Escape");

    await dialog.getByRole("button", { name: "Labels" }).click();
    const labels = openPopover(page);
    await labels.getByRole("button", { name: "Bug" }).click();
    await labels.getByRole("button", { name: "Feature" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog.getByText("Bug", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Feature", { exact: true })).toBeVisible();

    await dialog.getByRole("button", { name: "Cycle" }).click();
    await openPopover(page)
      .getByRole("button", { name: new RegExp(cycle.name) })
      .click();
    await expect(
      dialog.getByRole("button", { name: cycle.name }),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Modules" }).click();
    await openPopover(page).getByRole("button", { name: mod.name }).click();
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("button", { name: mod.name })).toBeVisible();

    await dialog.getByRole("button", { name: "Estimate" }).click();
    await openPopover(page)
      .getByRole("button", { name: /^3 pts/ })
      .click();
    await expect(dialog.getByRole("button", { name: /3 pts/ })).toBeVisible();

    // Typed last: choosing a priority afterwards wipes it (bug #7).
    await fillRichText(
      dialog.locator("[contenteditable='true']").first(),
      "Written in the create modal.",
    );
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(dialog).toBeHidden();

    const card = taskCard(boardColumn(page, "To Do"), title);
    await expect(card).toBeVisible();
    await expect(card).toHaveAccessibleName(
      /Assigned to Mia Member, Adam Admin/,
    );
    await expect(card).toContainText(shortDate(due));
    await expect(card).toContainText("Bug");
    await expect(card).toContainText(cycle.name.slice(0, 10));

    const board = await listBoard(api, project.id);
    const created = board.columns
      .flatMap((column) => column.tasks)
      .find((task) => task.title === title);
    if (!created) throw new Error("the task was not created");
    const task = await getTask(api, created.id);
    expect(task.status).toBe("to-do");
    expect(task.priority).toBe("high");
    expect(task.description).toContain("Written in the create modal.");
    expect(localYmd(task.startDate)).toBe(ymd(start));
    expect(localYmd(task.dueDate)).toBe(ymd(due));
    expect(task.assigneeIds).toEqual([
      seed.users.member.id,
      seed.users.admin.id,
    ]);
    expect(task.estimatePointId).toBe(
      estimate.points.find((point) => point.value === "3")?.id,
    );
    expect((await taskLabelNames(api, created.id)).sort()).toEqual([
      "Bug",
      "Feature",
    ]);
    expect(await taskModuleNames(api, created.id)).toEqual([mod.name]);
    await expect
      .poll(
        async () =>
          (await listBoard(api, project.id)).columns
            .flatMap((column) => column.tasks)
            .find((t) => t.id === created.id)?.cycleId,
      )
      .toBe(cycle.id);
  });
});

test.describe("capture bar", () => {
  test("tokens become chips and the task is created with them", async ({
    page,
    api,
    seed,
  }) => {
    project = await createProject(api, { name: uniqueName("Capture") });
    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);

    const column = boardColumn(page, "In Progress");
    const capture = column.getByRole("textbox", {
      name: "Add task to In Progress",
    });
    const title = uniqueName("Captured");
    await capture.fill(`${title} @mia !high tomorrow #bug #oops`);
    await expect(column.locator("[data-token]")).toHaveCount(5);
    // A removed chip leaves its text in the title.
    await column.getByRole("button", { name: "Remove #oops" }).click();
    await expect(column.locator("[data-token]")).toHaveCount(4);
    await capture.press("Enter");
    await expect(capture).toHaveValue("");
    await expect(capture).toBeFocused();

    await expect(taskCard(column, `${title} #oops`)).toBeVisible({
      timeout: 30_000,
    });
    const created = (await listBoard(api, project.id)).columns
      .flatMap((entry) => entry.tasks)
      .find((task) => task.title === `${title} #oops`);
    expect(created).toBeDefined();
    const task = await getTask(api, created?.id ?? "");
    expect(task.status).toBe("in-progress");
    expect(task.priority).toBe("high");
    expect(localYmd(task.dueDate as string)).toBe(ymd(localDay(1)));
    expect(await taskAssigneeIds(api, created?.id ?? "")).toEqual([
      seed.users.member.id,
    ]);
    await expect
      .poll(() => taskLabelNames(api, created?.id ?? ""))
      .toEqual(["Bug"]);
  });

  test("c focuses the entry column's capture bar and Ctrl Enter opens the full editor", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Capture keys") });
    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);

    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("c");
    const capture = boardColumn(page, "To Do").getByRole("textbox", {
      name: "Add task to To Do",
    });
    await expect(capture).toBeFocused();

    const title = uniqueName("Expanded");
    await capture.fill(`${title} !low`);
    await capture.press("ControlOrMeta+Enter");
    const dialog = createTaskDialog(page);
    await expect(dialog.getByPlaceholder("Task title")).toHaveValue(title);
    await expect(dialog.getByRole("button", { name: "Low" })).toBeVisible();
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(dialog).toBeHidden();
    await expect(taskCard(boardColumn(page, "To Do"), title)).toBeVisible();
  });
});

test("list triage moves with j/k, selects with x and changes priority with !", async ({
  page,
  api,
}) => {
  project = await createProject(api, { name: uniqueName("Triage") });
  const first = await createTask(api, project.id, {
    title: uniqueName("Triage one"),
    status: "to-do",
  });
  const second = await createTask(api, project.id, {
    title: uniqueName("Triage two"),
    status: "to-do",
  });
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);
  await toolbarButton(page, "List").click();
  await expect(taskCard(page, second.title)).toBeVisible();

  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const row = (id: string) => page.locator(`[data-task-row="${id}"]`);
  const order = await page
    .locator("[data-task-row]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-task-row")),
    );
  const top = order[0] ?? "";
  const next = order[1] ?? "";
  await page.keyboard.press("j");
  await expect(row(top)).toHaveAttribute("data-focused", "true");
  await page.keyboard.press("j");
  await expect(row(next)).toHaveAttribute("data-focused", "true");
  await page.keyboard.press("x");
  await expect(row(next)).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("x");
  await expect(row(next)).not.toHaveAttribute("data-selected", "true");

  await page.keyboard.press("!");
  await openPopover(page).getByRole("button", { name: "Urgent" }).click();
  await expect
    .poll(async () => (await getTask(api, next)).priority)
    .toBe("urgent");
  expect([first.id, second.id]).toContain(next);
  await restoreBoardLayout(page);
});

test("the create modal keeps a description when a priority is chosen after it", async ({
  page,
  api,
}) => {
  project = await createProject(api, { name: uniqueName("Board modal desc") });
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);
  await boardColumn(page, "To Do")
    .getByRole("button", { name: "Add task" })
    .click();
  const dialog = createTaskDialog(page);
  const title = uniqueName("Described first");
  await dialog.getByPlaceholder("Task title").fill(title);
  const editor = dialog.locator("[contenteditable='true']").first();
  await fillRichText(editor, "Keep this text");
  await dialog.getByRole("button", { name: "No priority" }).click();
  await openPopover(page).getByRole("button", { name: "High" }).click();
  await expect(editor).toHaveText("Keep this text", { timeout: 5_000 });
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();
  const created = (await listBoard(api, project.id)).columns
    .flatMap((column) => column.tasks)
    .find((task) => task.title === title);
  expect((await getTask(api, created?.id ?? "")).description).toContain(
    "Keep this text",
  );
});

test.describe("drag and drop", () => {
  test("moving a card to another column changes its status and survives a reload", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Board dnd") });
    const moving = await createTask(api, project.id, {
      title: uniqueName("Moving card"),
    });
    const resident = await createTask(api, project.id, {
      title: uniqueName("Review resident"),
      status: "in-review",
    });

    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);

    await dragAndDrop(
      page,
      taskCard(page, moving.title),
      taskCard(boardColumn(page, "In Review"), resident.title),
      { targetPosition: "bottom" },
    );

    await expect(
      taskCard(boardColumn(page, "In Review"), moving.title),
    ).toBeVisible();
    await expect
      .poll(async () => (await getTask(api, moving.id)).status)
      .toBe("in-review");

    await page.reload();
    await waitForBoardReady(page);
    await expect(
      taskCard(boardColumn(page, "In Review"), moving.title),
    ).toBeVisible();
    await expect(
      taskCard(boardColumn(page, "To Do"), moving.title),
    ).toHaveCount(0);
  });

  test("dropping a card into an empty column moves it there", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Board empty") });
    const moving = await createTask(api, project.id, {
      title: uniqueName("To empty"),
    });

    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);

    const done = boardColumn(page, "Done");
    await dragAndDrop(page, taskCard(page, moving.title), done, {
      targetPosition: "top",
    });

    await expect(taskCard(done, moving.title)).toBeVisible();
    await expect
      .poll(async () => (await getTask(api, moving.id)).status)
      .toBe("done");
  });

  test("reordering within a column persists the new order", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Board order") });
    const first = await createTask(api, project.id, {
      title: uniqueName("Order first"),
    });
    const second = await createTask(api, project.id, {
      title: uniqueName("Order second"),
    });
    const third = await createTask(api, project.id, {
      title: uniqueName("Order third"),
    });

    const columnTitles = async () =>
      (await listBoard(api, project.id)).columns
        .find((column) => column.id === "to-do" || column.name === "To Do")
        ?.tasks.map((task) => task.title);
    const initial = await columnTitles();
    expect(initial).toHaveLength(3);

    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);
    const column = boardColumn(page, "To Do");
    const cardTitles = () =>
      titlesInOrder(
        column,
        [first, second, third].map((task) => task.title),
      );
    await expect.poll(cardTitles).toEqual(initial);

    // Drag the top card below the bottom one.
    const top = initial?.[0] ?? first.title;
    const bottom = initial?.[2] ?? third.title;
    await dragAndDrop(page, taskCard(column, top), taskCard(column, bottom), {
      targetPosition: "bottom",
    });
    const expected = [initial?.[1], initial?.[2], initial?.[0]];
    await expect.poll(cardTitles).toEqual(expected);

    // The new order survives a reload and is what the API returns.
    await page.reload();
    await waitForBoardReady(page);
    await expect.poll(cardTitles).toEqual(expected);
    await expect.poll(columnTitles).toEqual(expected);
    void second;
  });
});

test.describe("filters, sort and layout", () => {
  /** A filter option row; its name gains a "✓" while selected. */
  const option = (submenu: Locator, name: string) =>
    submenu.getByRole("button", {
      name: new RegExp(`^(✓ )?(\\S{1,2} )?${escapeRegExp(name)}$`),
    });

  test("priority and label filters narrow the board and clear again", async ({
    page,
    api,
    seed,
  }) => {
    project = await createProject(api, { name: uniqueName("Board filtering") });
    const urgent = await createTask(api, project.id, {
      title: uniqueName("Urgent bug"),
      priority: "urgent",
    });
    const low = await createTask(api, project.id, {
      title: uniqueName("Low feature"),
      priority: "low",
    });
    const none = await createTask(api, project.id, {
      title: uniqueName("Plain task"),
    });
    await addLabelToTask(api, seed.labels.bug.id, urgent.id);
    await addLabelToTask(api, seed.labels.feature.id, low.id);

    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);
    for (const task of [urgent, low, none]) {
      await expect(taskCard(page, task.title)).toBeVisible();
    }

    let submenu = await openFilterSubmenu(page, "Priority");
    await option(submenu, "Urgent").click();
    await expect(option(submenu, "Urgent")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(taskCard(page, urgent.title)).toBeVisible();
    await expect(taskCard(page, low.title)).toHaveCount(0);
    await expect(taskCard(page, none.title)).toHaveCount(0);

    await option(submenu, "Low").click();
    await expect(taskCard(page, low.title)).toBeVisible();
    await closeMenus(page);
    const chip = page.getByRole("button", { name: "Priority is" });
    await expect(chip).toHaveText("2 selected");

    // The operator flips to "is not".
    await page.getByRole("button", { name: /^is( any of)?$/ }).click();
    await expect(taskCard(page, none.title)).toBeVisible();
    await expect(taskCard(page, urgent.title)).toHaveCount(0);
    await expect(taskCard(page, low.title)).toHaveCount(0);

    await page.getByRole("button", { name: "Remove filter Priority" }).click();
    await expect(chip).toHaveCount(0);
    for (const task of [urgent, low, none]) {
      await expect(taskCard(page, task.title)).toBeVisible();
    }

    submenu = await openFilterSubmenu(page, "Labels");
    await option(submenu, "Feature").click();
    await closeMenus(page);
    await expect(taskCard(page, low.title)).toBeVisible();
    await expect(taskCard(page, urgent.title)).toHaveCount(0);
    await expect(taskCard(page, none.title)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Labels is" })).toHaveText(
      "Feature",
    );

    await toolbarButton(page, "Filter").click();
    await page.getByRole("menuitem", { name: "Clear all filters" }).click();
    for (const task of [urgent, low, none]) {
      await expect(taskCard(page, task.title)).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Labels is" })).toHaveCount(
      0,
    );
  });

  test("the assignee filter handles No assignee and several people", async ({
    page,
    api,
    seed,
  }) => {
    project = await createProject(api, { name: uniqueName("Board people") });
    const mia = await createTask(api, project.id, {
      title: uniqueName("Mia work"),
      assigneeIds: [seed.users.member.id],
    });
    const adam = await createTask(api, project.id, {
      title: uniqueName("Adam work"),
      assigneeIds: [seed.users.admin.id],
    });
    const pair = await createTask(api, project.id, {
      title: uniqueName("Pair work"),
      assigneeIds: [seed.users.owner.id, seed.users.member.id],
    });
    const nobody = await createTask(api, project.id, {
      title: uniqueName("Nobody work"),
    });

    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);

    let submenu = await openFilterSubmenu(page, "Assignee");
    await option(submenu, "No assignee").click();
    await closeMenus(page);
    await expect(taskCard(page, nobody.title)).toBeVisible();
    for (const task of [mia, adam, pair]) {
      await expect(taskCard(page, task.title)).toHaveCount(0);
    }

    // Any of: nobody or Adam.
    submenu = await openFilterSubmenu(page, "Assignee");
    await option(submenu, "Adam Admin").click();
    await closeMenus(page);
    await expect(taskCard(page, nobody.title)).toBeVisible();
    await expect(taskCard(page, adam.title)).toBeVisible();
    await expect(taskCard(page, mia.title)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Assignee is/ }),
    ).toContainText("2 selected");

    // Only Mia: a task matches when any of its assignees is selected.
    submenu = await openFilterSubmenu(page, "Assignee");
    await option(submenu, "No assignee").click();
    await option(submenu, "Adam Admin").click();
    await option(submenu, "Mia Member").click();
    await closeMenus(page);
    await expect(taskCard(page, mia.title)).toBeVisible();
    await expect(taskCard(page, pair.title)).toBeVisible();
    await expect(taskCard(page, adam.title)).toHaveCount(0);
    await expect(taskCard(page, nobody.title)).toHaveCount(0);

    // "Me" is the signed-in owner.
    submenu = await openFilterSubmenu(page, "Assignee");
    await option(submenu, "Mia Member").click();
    await option(submenu, "Me").click();
    await closeMenus(page);
    await expect(taskCard(page, pair.title)).toBeVisible();
    await expect(taskCard(page, mia.title)).toHaveCount(0);
  });

  test("the due date filter picks today, next week and no date", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Board dates") });
    // Aim at next week's Wednesday so either week convention agrees.
    const today = localDay(0);
    const toNextWeek = 7 - today.getDay() + 3;
    const dueToday = await createTask(api, project.id, {
      title: uniqueName("Due today"),
      dueDate: localDay(0).toISOString(),
    });
    const nextWeek = await createTask(api, project.id, {
      title: uniqueName("Due later"),
      dueDate: localDay(toNextWeek).toISOString(),
    });
    const overdue = await createTask(api, project.id, {
      title: uniqueName("Late one"),
      dueDate: localDay(-3).toISOString(),
    });
    const undated = await createTask(api, project.id, {
      title: uniqueName("Undated"),
    });
    const all = [dueToday, nextWeek, overdue, undated];
    const onlyShows = async (visible: typeof dueToday) => {
      for (const task of all) {
        if (task === visible)
          await expect(taskCard(page, task.title)).toBeVisible();
        else await expect(taskCard(page, task.title)).toHaveCount(0);
      }
    };

    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);

    const toggleDue = async (name: string) => {
      const submenu = await openFilterSubmenu(page, "Due date");
      await option(submenu, name).click();
      await closeMenus(page);
    };

    await toggleDue("Today");
    await onlyShows(dueToday);
    await toggleDue("Today");
    await toggleDue("Next week");
    await onlyShows(nextWeek);
    await toggleDue("Next week");
    await toggleDue("Overdue");
    await onlyShows(overdue);
    await toggleDue("Overdue");
    await toggleDue("None");
    await onlyShows(undated);
  });

  test("ordering by title and priority, then back to manual", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Board ordering") });
    const suffix = uniqueName("s");
    const bravo = await createTask(api, project.id, {
      title: `Bravo ${suffix}`,
      priority: "low",
    });
    const alpha = await createTask(api, project.id, {
      title: `Alpha ${suffix}`,
      priority: "medium",
    });
    const charlie = await createTask(api, project.id, {
      title: `Charlie ${suffix}`,
      priority: "urgent",
    });
    const titles = [alpha.title, bravo.title, charlie.title];

    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);
    const column = boardColumn(page, "To Do");
    const order = () => titlesInOrder(column, titles);
    await expect.poll(order).toEqual([bravo.title, alpha.title, charlie.title]);

    const display = await openDisplayMenu(page);
    // "Order by" has no accessible name; it is the combobox after its label.
    const orderBy = display
      .getByText("Order by", { exact: true })
      .locator("xpath=following::*[@role='combobox'][1]");
    await orderBy.click();
    await page.getByRole("option", { name: "Title" }).click();
    await expect(orderBy).toHaveText("Title");
    await expect.poll(order).toEqual([alpha.title, bravo.title, charlie.title]);

    await display.getByRole("button", { name: "Ascending" }).click();
    await expect(
      display.getByRole("button", { name: "Descending" }),
    ).toBeVisible();
    await expect.poll(order).toEqual([charlie.title, bravo.title, alpha.title]);

    await orderBy.click();
    await page.getByRole("option", { name: "Priority" }).click();
    await expect.poll(order).toEqual([charlie.title, alpha.title, bravo.title]);

    await orderBy.click();
    await page.getByRole("option", { name: "Manual" }).click();
    await expect(
      display.getByRole("button", { name: /Ascending|Descending/ }),
    ).toBeDisabled();
    await expect.poll(order).toEqual([bravo.title, alpha.title, charlie.title]);
  });

  test("display properties hide and show card details", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Board props") });
    const task = await createTask(api, project.id, {
      title: uniqueName("Props task"),
      dueDate: localDay(3).toISOString(),
    });
    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);
    const card = taskCard(page, task.title);
    const key = `${project.slug}-${task.number}`;
    await expect(card).toContainText(key);
    await expect(card).toContainText(shortDate(localDay(3)));

    const display = await openDisplayMenu(page);
    await display.getByRole("button", { name: "Key", exact: true }).click();
    await expect(
      display.getByRole("button", { name: "Key", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await display
      .getByRole("button", { name: "Due date", exact: true })
      .click();
    await expect(card).not.toContainText(key);
    await expect(card).not.toContainText(shortDate(localDay(3)));

    await display.getByRole("button", { name: "Key", exact: true }).click();
    await display
      .getByRole("button", { name: "Due date", exact: true })
      .click();
    await expect(card).toContainText(key);
    await expect(card).toContainText(shortDate(localDay(3)));
  });

  test("grouping by priority regroups the board and back", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Board grouping") });
    const urgentTask = await createTask(api, project.id, {
      title: uniqueName("Grouped urgent"),
      priority: "urgent",
    });
    const lowTask = await createTask(api, project.id, {
      title: uniqueName("Grouped low"),
      priority: "low",
      status: "in-progress",
    });
    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);

    const display = await openDisplayMenu(page);
    const groupBy = display
      .getByText("Group by", { exact: true })
      .locator("xpath=following::*[@role='combobox'][1]");
    await expect(groupBy).toHaveText("Status");
    await groupBy.click();
    await page.getByRole("option", { name: "Priority", exact: true }).click();
    await expect(groupBy).toHaveText("Priority");
    await closeMenus(page);

    // Columns are now priorities, whatever the status.
    const main = page.getByRole("main");
    await expect(
      main.getByText("Urgent", { exact: true }).first(),
    ).toBeVisible();
    await expect(main.getByText("Low", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("In Progress", { exact: true })).toHaveCount(0);
    await expect(taskCard(page, urgentTask.title).first()).toBeVisible();
    await expect(taskCard(page, lowTask.title).first()).toBeVisible();
    const order = await titlesInOrder(main, [urgentTask.title, lowTask.title]);
    expect(order).toEqual([urgentTask.title, lowTask.title]);

    const again = await openDisplayMenu(page);
    await again
      .getByText("Group by", { exact: true })
      .locator("xpath=following::*[@role='combobox'][1]")
      .click();
    await page.getByRole("option", { name: "Status", exact: true }).click();
    await closeMenus(page);
    await expect(
      taskCard(boardColumn(page, "In Progress"), lowTask.title),
    ).toBeVisible();
  });

  test("the board and list toggle switches layouts with the same tasks", async ({
    page,
    api,
  }) => {
    project = await createProject(api, { name: uniqueName("Board layout") });
    const todo = await createTask(api, project.id, {
      title: uniqueName("Toggle todo"),
    });
    const doing = await createTask(api, project.id, {
      title: uniqueName("Toggle doing"),
      status: "in-progress",
    });

    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);
    await expect(
      taskCard(boardColumn(page, "To Do"), todo.title),
    ).toBeVisible();

    await toolbarButton(page, "List").click();
    // The list groups tasks under collapsible status headers.
    const todoGroup = page.getByRole("button", {
      name: "To Do 1",
      exact: true,
    });
    const inProgressGroup = page.getByRole("button", {
      name: "In Progress 1",
      exact: true,
    });
    await expect(todoGroup).toBeVisible();
    await expect(inProgressGroup).toBeVisible();
    await expect(taskCard(page, todo.title)).toBeVisible();
    await expect(taskCard(page, doing.title)).toBeVisible();

    // Collapsing a group hides its rows.
    await inProgressGroup.click();
    await expect(taskCard(page, doing.title)).toHaveCount(0);
    await inProgressGroup.click();
    await expect(taskCard(page, doing.title)).toBeVisible();

    // The choice sticks across a reload.
    await page.reload();
    await expect(todoGroup).toBeVisible({ timeout: 60_000 });

    await toolbarButton(page, "Board").click();
    await expect(
      taskCard(boardColumn(page, "In Progress"), doing.title),
    ).toBeVisible();
    await expect(todoGroup).toHaveCount(0);
  });
});
