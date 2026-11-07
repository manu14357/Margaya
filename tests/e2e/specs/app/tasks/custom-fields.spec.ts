import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { readJson } from "../../../helpers/http";
import {
  boardPath,
  createProject,
  createTask,
  deleteProject,
  type TestProject,
  type TestTask,
} from "../../../helpers/task-data";
import {
  escapeRegExp,
  layoutTab,
  openDisplayMenu,
  openPopover,
  titlesInOrder,
  toast,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

type Field = { id: string; name: string };

let project: TestProject;
let alpha: TestTask;
let beta: TestTask;
let empty: TestTask;
let stage: Field;
let score: Field;

async function createField(
  api: APIRequestContext,
  data: Record<string, unknown>,
): Promise<Field> {
  const response = await api.post("/api/custom-field", {
    data: { projectId: project.id, ...data },
  });
  expect(response.ok()).toBe(true);
  return readJson<Field>(response, "create custom field");
}

async function setValue(
  api: APIRequestContext,
  taskId: string,
  fieldId: string,
  value: string,
) {
  const response = await api.put("/api/custom-field/value", {
    data: { taskId, fieldId, value },
  });
  expect(response.ok()).toBe(true);
}

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Fields") });
  const suffix = uniqueName("r");
  alpha = await createTask(api, project.id, { title: `Alpha ${suffix}` });
  beta = await createTask(api, project.id, { title: `Beta ${suffix}` });
  empty = await createTask(api, project.id, { title: `Empty ${suffix}` });
  stage = await createField(api, {
    name: "Stage",
    type: "dropdown",
    options: ["Plan", "Ship", "Old"],
  });
  score = await createField(api, { name: "Score", type: "number" });
  await setValue(api, alpha.id, stage.id, "Ship");
  await setValue(api, beta.id, stage.id, "Old");
  await setValue(api, alpha.id, score.id, "10");
  await setValue(api, beta.id, score.id, "9");
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

function workflowPath() {
  return `/dashboard/settings/projects/${project.id}/workflow`;
}

function sheetPath() {
  return boardPath(project.id).replace(/\/board$/, "/spreadsheet");
}

function rowOf(page: Page, task: TestTask) {
  return page.getByRole("row", { name: new RegExp(escapeRegExp(task.title)) });
}

async function openList(page: Page) {
  await page.goto(boardPath(project.id));
  await layoutTab(page, "List").click();
  await expect(page.getByText(alpha.title).first()).toBeVisible({
    timeout: 60_000,
  });
}

async function chooseDisplayOption(page: Page, row: string, option: string) {
  const popover = await openDisplayMenu(page);
  await popover.getByRole("combobox", { name: row, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await page.keyboard.press("Escape");
}

async function storedValues(api: APIRequestContext, taskId: string) {
  const response = await api.get(`/api/custom-field/task/${taskId}`);
  const values = await readJson<Array<{ fieldId: string; value: string }>>(
    response,
    "read custom field values",
  );
  return Object.fromEntries(values.map((row) => [row.fieldId, row.value]));
}

test("renaming an option moves tasks; removing one leaves them", async ({
  page,
  api,
}) => {
  await page.goto(workflowPath());
  const row = page.getByRole("listitem").filter({ hasText: "Stage" });
  await row.getByRole("button", { name: /^Edit/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Edit custom field" }),
  ).toBeVisible();
  await dialog.getByLabel("Name", { exact: true }).fill("Phase");
  const options = dialog.getByRole("textbox", { name: "Option name" });
  await options.nth(1).fill("Shipped");
  await dialog.getByRole("button", { name: "Remove option: Old" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Custom field updated.")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Phase" }),
  ).toContainText("2 options");

  expect((await storedValues(api, alpha.id))[stage.id]).toBe("Shipped");
  // A removed option stays on the tasks that have it.
  expect((await storedValues(api, beta.id))[stage.id]).toBe("Old");
});

test("a list groups by a custom field, with no value last", async ({
  page,
}) => {
  await openList(page);

  await chooseDisplayOption(page, "Group by", "Stage");

  for (const header of ["Ship", "Old", "No value"]) {
    await expect(page.getByText(header, { exact: true }).first()).toBeVisible();
  }
  expect(
    await titlesInOrder(page.getByRole("main"), [
      alpha.title,
      beta.title,
      empty.title,
    ]),
  ).toEqual([alpha.title, beta.title, empty.title]);
});

test("a list sorts by a custom field as numbers", async ({ page }) => {
  await openList(page);

  await chooseDisplayOption(page, "Group by", "None");
  await chooseDisplayOption(page, "Order by", "Score");

  // 9 before 10, which text order would flip; no value goes last.
  await expect
    .poll(() =>
      titlesInOrder(page.getByRole("main"), [
        alpha.title,
        beta.title,
        empty.title,
      ]),
    )
    .toEqual([beta.title, alpha.title, empty.title]);
});

test("a spreadsheet edits a custom field in place", async ({ page, api }) => {
  await page.goto(sheetPath());
  await expect(page.getByRole("table")).toBeVisible({ timeout: 60_000 });

  const popover = await openDisplayMenu(page);
  await popover.getByRole("button", { name: "Stage", exact: true }).click();
  await popover.getByRole("button", { name: "Score", exact: true }).click();
  await page.keyboard.press("Escape");

  // A typed value.
  const scoreCell = rowOf(page, empty).getByRole("button", {
    name: "Edit Score",
  });
  await scoreCell.click();
  const input = rowOf(page, empty).getByRole("spinbutton", {
    name: "Edit Score",
  });
  await input.fill("42");
  await input.press("Enter");
  await expect(rowOf(page, empty)).toContainText("42");

  await expect
    .poll(async () => (await storedValues(api, empty.id))[score.id])
    .toBe("42");

  // A picked value.
  await rowOf(page, alpha).getByRole("button", { name: "Ship" }).click();
  await openPopover(page)
    .getByRole("button", { name: "Plan", exact: true })
    .click();
  await expect
    .poll(async () => (await storedValues(api, alpha.id))[stage.id])
    .toBe("Plan");

  // The value survives a reload.
  await page.reload();
  await expect(rowOf(page, empty)).toContainText("42");
});

test("the bulk toolbar sets a custom field on the selection", async ({
  page,
  api,
}) => {
  await page.goto(sheetPath());
  await expect(page.getByRole("table")).toBeVisible({ timeout: 60_000 });

  for (const task of [alpha, empty]) {
    await rowOf(page, task).getByRole("checkbox").click();
  }
  const bar = page.getByRole("toolbar");
  await expect(bar.getByText("2 selected")).toBeVisible();

  await bar.getByRole("button", { name: "Custom field" }).click();
  const popover = openPopover(page);
  await popover.getByRole("button", { name: "Stage", exact: true }).click();
  await popover.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(toast(page, "Updated 2 tasks")).toBeVisible();

  await expect
    .poll(async () => (await storedValues(api, alpha.id))[stage.id])
    .toBe("Plan");
  expect((await storedValues(api, empty.id))[stage.id]).toBe("Plan");
  // A task outside the selection keeps its value.
  expect((await storedValues(api, beta.id))[stage.id]).toBe("Old");
});
