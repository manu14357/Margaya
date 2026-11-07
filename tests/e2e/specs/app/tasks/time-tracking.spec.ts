import { expect, test } from "../../../fixtures";
import {
  boardPath,
  createProject,
  createTask,
  deleteProject,
  setProjectFeatures,
  type TestProject,
  taskPagePath,
} from "../../../helpers/task-data";
import { openTaskPage, toast } from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// Time tracking from the task's "Time spent" row: start, switch and stop a
// timer, correct an entry, and find the totals on the analytics page.

test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Time") });
  await setProjectFeatures(api, project.id, { timeTrackingEnabled: true });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

test("one timer runs at a time: starting on a second task stops the first", async ({
  page,
  api,
}) => {
  const first = await createTask(api, project.id, {
    title: uniqueName("First"),
  });
  const second = await createTask(api, project.id, {
    title: uniqueName("Second"),
  });

  await openTaskPage(page, taskPagePath(project.id, first.id));
  await page.getByRole("button", { name: "Log time" }).first().click();
  await page.getByRole("button", { name: "Start timer" }).click();
  await expect(toast(page, "Timer started")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();

  await openTaskPage(page, taskPagePath(project.id, second.id));
  await page.getByRole("button", { name: "Log time" }).first().click();
  await expect(
    page.getByRole("link", { name: /Timer running on/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop it and start here" }).click();
  await expect(
    toast(page, "Timer started. Your other timer was stopped."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(toast(page, /Timer stopped/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Time entries" }).getByText("Running"),
  ).toHaveCount(0);
});

test("a logged entry can be corrected, and a bad range is refused", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Corrected"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));
  await page.getByRole("button", { name: "Log time" }).first().click();
  await page.getByLabel("Duration").fill("1h");
  await page.getByRole("button", { name: "Log time" }).last().click();
  await expect(toast(page, "Time logged")).toBeVisible();

  const entries = page.getByRole("list", { name: "Time entries" });
  await entries.getByRole("button", { name: /Edit time entry/ }).click();

  await page.getByLabel("End", { exact: true }).fill("2020-01-01T00:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("The end can't be before the start."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await entries.getByRole("button", { name: /Edit time entry/ }).click();
  await page.getByLabel("Note (optional)").fill("Pairing");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(toast(page, "Time entry updated")).toBeVisible();
  await expect(entries.getByText(/Pairing/)).toBeVisible();
});

test("analytics shows the time by person and by project", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Reported"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));
  await page.getByRole("button", { name: "Log time" }).first().click();
  await page.getByLabel("Duration").fill("1h 30m");
  await page.getByRole("button", { name: "Log time" }).last().click();
  await expect(toast(page, "Time logged")).toBeVisible();

  await page.goto(
    boardPath(project.id).replace(/board$/, "analytics?tab=time"),
  );
  await expect(page.getByText("By person")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("By project")).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "1h 30m" }).first(),
  ).toBeVisible();
});
