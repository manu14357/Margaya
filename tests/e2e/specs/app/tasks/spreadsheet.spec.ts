import type { Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { readJson } from "../../../helpers/http";
import {
  boardPath,
  createProject,
  createTask,
  deleteProject,
  getTask,
  isoDayOffset,
  type TestProject,
  type TestTask,
} from "../../../helpers/task-data";
import {
  escapeRegExp,
  localDay,
  localYmd,
  openDisplayMenu,
  openPopover,
  pickCalendarDay,
  shortDate,
  taskSheet,
  titlesInOrder,
  toast,
  ymd,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;
let urgent: TestTask;
let low: TestTask;
let high: TestTask;

test.beforeEach(async ({ api, seed }) => {
  project = await createProject(api, { name: uniqueName("Spreadsheet") });
  const suffix = uniqueName("r");
  low = await createTask(api, project.id, {
    title: `Low row ${suffix}`,
    priority: "low",
  });
  urgent = await createTask(api, project.id, {
    title: `Urgent row ${suffix}`,
    priority: "urgent",
    dueDate: isoDayOffset(3),
    assigneeIds: [seed.users.member.id],
  });
  high = await createTask(api, project.id, {
    title: `High row ${suffix}`,
    priority: "high",
    status: "in-progress",
  });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

function sheetPath() {
  return boardPath(project.id).replace(/\/board$/, "/spreadsheet");
}

async function openSheet(page: Page) {
  await page.goto(sheetPath());
  await expect(page.getByRole("table")).toBeVisible({ timeout: 60_000 });
  await expect(rowOf(page, urgent)).toBeVisible();
  columnOrder = (await page.getByRole("columnheader").allInnerTexts()).map(
    (text) => text.trim(),
  );
}

function rowOf(page: Page, task: TestTask) {
  return page.getByRole("row", { name: new RegExp(escapeRegExp(task.title)) });
}

/** Header names of the default spreadsheet columns. */
const COLUMN = {
  status: "Status",
  priority: "Priority",
  assignees: "Assignees",
  labels: "Labels",
  due: "Due date",
} as const;

let columnOrder: string[] = [];

/** A row's cell under the header named `column` (read once per page). */
function cellOf(page: Page, task: TestTask, column: string) {
  const index = columnOrder.indexOf(column);
  if (index < 0)
    throw new Error(`no column ${column} in ${columnOrder.join(", ")}`);
  return rowOf(page, task).getByRole("cell").nth(index);
}

test("rows show every property and cells edit in place", async ({
  page,
  api,
  seed,
}) => {
  await openSheet(page);
  const headers = page.getByRole("columnheader");
  for (const name of [
    "Status",
    "Priority",
    "Assignees",
    "Labels",
    "Due date",
  ]) {
    await expect(
      headers.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  }
  const row = rowOf(page, urgent);
  await expect(row).toContainText(`${project.slug}-${urgent.number}`);
  await expect(cellOf(page, urgent, COLUMN.status)).toHaveText("To Do");
  await expect(cellOf(page, urgent, COLUMN.priority)).toHaveText("Urgent");
  await expect(
    cellOf(page, urgent, COLUMN.assignees).getByRole("img", {
      name: "Assigned to Mia Member",
    }),
  ).toBeVisible();
  await expect(cellOf(page, urgent, COLUMN.due)).toHaveText(
    shortDate(localDay(3)),
  );

  // Status
  await cellOf(page, low, COLUMN.status).getByRole("button").click();
  await openPopover(page)
    .getByRole("button", { name: /^In Review/ })
    .click();
  await expect(cellOf(page, low, COLUMN.status)).toHaveText("In Review");

  // Priority
  await cellOf(page, low, COLUMN.priority).getByRole("button").click();
  await openPopover(page)
    .getByRole("button", { name: /^Medium/ })
    .click();
  await expect(cellOf(page, low, COLUMN.priority)).toHaveText("Medium");

  // Assignee
  await cellOf(page, low, COLUMN.assignees).getByRole("button").click();
  await openPopover(page)
    .getByRole("menuitemcheckbox", { name: /Adam Admin/ })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    cellOf(page, low, COLUMN.assignees).getByRole("img", {
      name: "Assigned to Adam Admin",
    }),
  ).toBeVisible();

  // Due date
  await cellOf(page, low, COLUMN.due).getByRole("button").click();
  await pickCalendarDay(openPopover(page), localDay(6));
  await expect(toast(page, "Task due date updated successfully")).toBeVisible();
  await expect(cellOf(page, low, COLUMN.due)).toHaveText(
    shortDate(localDay(6)),
  );

  await expect
    .poll(async () => {
      const saved = await getTask(api, low.id);
      return [
        saved.status,
        saved.priority,
        saved.assigneeIds,
        localYmd(saved.dueDate),
      ];
    })
    .toEqual(["in-review", "medium", [seed.users.admin.id], ymd(localDay(6))]);
});

test("column headers sort and hide columns", async ({ page }) => {
  await openSheet(page);
  const titles = [urgent.title, high.title, low.title];
  const order = () => titlesInOrder(page.getByRole("table"), titles);

  const priorityHeader = page.getByRole("columnheader", { name: "Priority" });
  await priorityHeader.getByRole("button").click();
  await page.getByRole("menuitem", { name: "Sort descending" }).click();
  await expect(priorityHeader).toHaveAttribute("aria-sort", "descending");
  await expect.poll(order).toEqual([urgent.title, high.title, low.title]);

  await priorityHeader.getByRole("button").click();
  await page.getByRole("menuitem", { name: "Sort ascending" }).click();
  await expect(priorityHeader).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(order).toEqual([low.title, high.title, urgent.title]);

  await priorityHeader.getByRole("button").click();
  await page.getByRole("menuitem", { name: "Clear sort" }).click();
  await expect(priorityHeader).toHaveAttribute("aria-sort", "none");

  // Hide the Labels column, then bring it back from Display.
  await page
    .getByRole("columnheader", { name: "Labels" })
    .getByRole("button")
    .click();
  // The Priority menu may still be closing; pick the Labels menu's item.
  await page
    .getByRole("menu", { name: "Labels" })
    .getByRole("menuitem", { name: "Hide column" })
    .click();
  await expect(page.getByRole("columnheader", { name: "Labels" })).toHaveCount(
    0,
  );

  const display = await openDisplayMenu(page);
  const labelsToggle = display.getByRole("button", {
    name: "Labels",
    exact: true,
  });
  await expect(labelsToggle).toHaveAttribute("aria-pressed", "false");
  await labelsToggle.click();
  await expect(
    page.getByRole("columnheader", { name: "Labels" }),
  ).toBeVisible();
});

test("row checkboxes feed the selection bar and titles open the task", async ({
  page,
  api,
}) => {
  await openSheet(page);
  const bar = page.getByRole("toolbar");
  for (const [index, task] of [urgent, low].entries()) {
    const key = `${project.slug}-${task.number}`;
    await rowOf(page, task).hover();
    await page.getByRole("checkbox", { name: `Select ${key}` }).click();
    // The row itself doesn't show it (bug #6); the selection bar counts it.
    await expect(bar.getByText(`${index + 1} selected`)).toBeVisible();
  }
  await bar.getByRole("button", { name: "Actions" }).click();
  const palette = page
    .getByRole("dialog")
    .filter({ has: page.getByPlaceholder("Search actions...") });
  await palette
    .getByRole("group", { name: "Change status" })
    .getByRole("option", { name: "Done" })
    .click();
  await expect(toast(page, "2 tasks updated")).toBeVisible();
  await expect(cellOf(page, urgent, COLUMN.status)).toHaveText("Done");
  await expect(cellOf(page, low, COLUMN.status)).toHaveText("Done");
  await expect(cellOf(page, high, COLUMN.status)).toHaveText("In Progress");
  for (const task of [urgent, low]) {
    expect((await getTask(api, task.id)).status).toBe("done");
  }

  // The title opens the task sheet.
  await rowOf(page, high).getByRole("button", { name: high.title }).click();
  await expect(page).toHaveURL(new RegExp(`taskId=${high.id}`));
  await expect(
    taskSheet(page).getByRole("textbox", { name: "Click to add a title" }),
  ).toHaveValue(high.title);
});

test("sub-tasks expand under their parent row", async ({ page, api }) => {
  const child = await createTask(api, project.id, {
    title: uniqueName("Child row"),
  });
  await readJson(
    await api.post("/api/task-relation", {
      data: {
        sourceTaskId: urgent.id,
        targetTaskId: child.id,
        relationType: "subtask",
      },
    }),
    "link sub-task",
  );

  await openSheet(page);
  const parentRow = rowOf(page, urgent);
  const expand = parentRow.getByRole("button", { name: "Show sub-tasks" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(parentRow.getByRole("cell").nth(-2)).toHaveText("1");
  await expand.click();
  await expect(
    parentRow.getByRole("button", { name: "Hide sub-tasks" }),
  ).toHaveAttribute("aria-expanded", "true");
  const titles = await titlesInOrder(page.getByRole("table"), [
    urgent.title,
    child.title,
  ]);
  expect(titles.slice(0, 2)).toEqual([urgent.title, child.title]);

  await parentRow.getByRole("button", { name: "Hide sub-tasks" }).click();
  await expect(
    parentRow.getByRole("button", { name: "Show sub-tasks" }),
  ).toBeVisible();
});

test("the project header switches between board and spreadsheet", async ({
  page,
}) => {
  await openSheet(page);
  const main = page.getByRole("main");
  // The project's layouts are tabs in the tab row.
  await main.getByRole("tab", { name: "Board", exact: true }).click();
  await expect(page).toHaveURL(/\/board/);
  await expect(page.getByRole("table")).toHaveCount(0);
  await main.getByRole("tab", { name: "Spreadsheet", exact: true }).click();
  await expect(page).toHaveURL(/\/spreadsheet/);
  await expect(page.getByRole("table")).toBeVisible();
});

test("a selected row shows its checkbox checked", async ({ page }) => {
  await openSheet(page);
  const key = `${project.slug}-${urgent.number}`;
  await rowOf(page, urgent).hover();
  const box = page.getByRole("checkbox", { name: `Select ${key}` });
  await box.click();
  await expect(page.getByRole("toolbar").getByText("1 selected")).toBeVisible();
  await expect(box).toBeChecked({ timeout: 5_000 });
  await expect(rowOf(page, urgent)).toHaveAttribute("aria-selected", "true");
});
