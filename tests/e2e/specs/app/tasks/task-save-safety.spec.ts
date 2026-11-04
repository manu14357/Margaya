import { expect, test } from "../../../fixtures";
import {
  boardPath,
  createProject,
  createTask,
  deleteProject,
  getTask,
  type TestProject,
  taskPagePath,
} from "../../../helpers/task-data";
import {
  boardColumn,
  dragAndDrop,
  openTaskPage,
  taskCard,
  toast,
  waitForBoardReady,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// A failed save must be visible and recoverable, a tab must not close over
// unsaved text, and moving a card must not write back the board's stale copy.

test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Save safety") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

test("a failed title save shows an error, keeps the text and retries", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Original"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));

  const failSaves = "**/api/task/title/*";
  await page.route(failSaves, (route) =>
    route.fulfill({ status: 500, body: "Server error" }),
  );

  const newTitle = uniqueName("Renamed");
  const title = page.getByRole("textbox", { name: "Click to add a title" });
  await title.fill(newTitle);

  await expect(toast(page, "Your title didn't save.")).toBeVisible();
  await expect(title).toHaveValue(newTitle);
  expect((await getTask(api, task.id)).title).toBe(task.title);

  await page.unroute(failSaves);
  await page
    .getByRole("region", { name: "Notifications" })
    .getByRole("button", { name: "Try again" })
    .click();

  await expect
    .poll(async () => (await getTask(api, task.id)).title)
    .toBe(newTitle);
  await expect(title).toHaveValue(newTitle);
});

test("a failed description save shows an error, keeps the text and retries", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Describe me"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));

  const failSaves = "**/api/task/description/*";
  await page.route(failSaves, (route) =>
    route.fulfill({ status: 500, body: "Server error" }),
  );

  const text = uniqueName("Unsaved words");
  const editor = page
    .getByRole("region", { name: "Task description editor" })
    .locator("[contenteditable='true']");
  await editor.click();
  await page.keyboard.type(text);

  await expect(toast(page, "Your description didn't save.")).toBeVisible();
  await expect(editor).toContainText(text);

  await page.unroute(failSaves);
  await page
    .getByRole("region", { name: "Notifications" })
    .getByRole("button", { name: "Try again" })
    .click();

  await expect
    .poll(async () => (await getTask(api, task.id)).description)
    .toContain(text);
});

test("closing the tab warns about a title that has not saved", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Leave me"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));

  await page.route("**/api/task/title/*", (route) =>
    route.fulfill({ status: 500, body: "Server error" }),
  );
  const title = page.getByRole("textbox", { name: "Click to add a title" });
  // Browsers only warn on a page the user has really interacted with.
  await title.click();
  await title.fill(uniqueName("Not saved"));
  await expect(toast(page, "Your title didn't save.")).toBeVisible();

  const warned = page.waitForEvent("dialog");
  void page.close({ runBeforeUnload: true });
  const dialog = await warned;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
});

test("moving a card from a stale board keeps a colleague's newer title", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Loaded title"),
    status: "to-do",
  });
  const resident = await createTask(api, project.id, {
    title: uniqueName("Already there"),
    status: "in-review",
  });

  // No realtime hints reach this board, so it stays stale when the task is
  // renamed behind its back.
  await page.routeWebSocket(/.*/, () => {});
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);

  const newerTitle = uniqueName("Newer title");
  const renamed = await api.put(`/api/task/title/${task.id}`, {
    data: { title: newerTitle },
  });
  expect(renamed.ok()).toBe(true);

  const moves: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/api/task/")) {
      moves.push({
        url: new URL(request.url()).pathname,
        body: request.postDataJSON(),
      });
    }
  });

  await dragAndDrop(
    page,
    taskCard(page, task.title),
    taskCard(boardColumn(page, "In Review"), resident.title),
    { targetPosition: "bottom" },
  );

  await expect
    .poll(async () => (await getTask(api, task.id)).status)
    .toBe("in-review");
  const stored = await getTask(api, task.id);
  expect(stored.title).toBe(newerTitle);

  expect(moves).toContainEqual({
    url: `/api/task/position/${task.id}`,
    body: expect.objectContaining({ status: "in-review" }),
  });
  for (const move of moves as { url: string; body: object }[]) {
    expect(move.url).toMatch(/^\/api\/task\/position\//);
    expect(move.body).not.toHaveProperty("title");
  }
});
