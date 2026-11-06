import { expect, test } from "../../../fixtures";
import {
  boardPath,
  createProject,
  createTask,
  createView,
  deleteProject,
  projectViewPath,
  type TestProject,
} from "../../../helpers/task-data";
import {
  boardColumn,
  layoutTab,
  restoreBoardLayout,
  taskCard,
  waitForBoardReady,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Tabs and search") });
});

test.afterEach(async ({ api }) => {
  await deleteProject(api, project.id);
});

test.describe("project tabs", () => {
  test("List is a tab of its own that always matches the view on screen", async ({
    api,
    page,
  }) => {
    const task = await createTask(api, project.id, {
      title: uniqueName("Tabbed task"),
      status: "to-do",
    });
    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);
    await expect(layoutTab(page, "Board")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      taskCard(boardColumn(page, "To Do"), task.title),
    ).toBeVisible();

    await layoutTab(page, "List").click();
    await expect(layoutTab(page, "List")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(layoutTab(page, "Board")).toHaveAttribute(
      "aria-selected",
      "false",
    );
    // The list's group headers, and the same URL as before.
    await expect(
      page.getByRole("button", { name: "To Do 1", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/board/);

    // It sticks across a reload, and through another tab and back.
    await page.reload();
    await expect(layoutTab(page, "List")).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 60_000 },
    );
    await layoutTab(page, "Gantt").click();
    await expect(page).toHaveURL(/\/gantt/);
    await layoutTab(page, "List").click();
    await expect(page).toHaveURL(/\/board/);
    await expect(
      page.getByRole("button", { name: "To Do 1", exact: true }),
    ).toBeVisible();

    await restoreBoardLayout(page);
    await expect(
      taskCard(boardColumn(page, "To Do"), task.title),
    ).toBeVisible();
  });

  test("a saved view does not repeat the layout names under the tabs", async ({
    api,
    page,
    seed,
  }) => {
    const view = await createView(api, {
      name: uniqueName("Layout names"),
      projectId: project.id,
    });
    await page.goto(
      `/dashboard/workspace/${seed.workspace.id}/project/${project.id}/views/${view.id}`,
    );
    const main = page.getByRole("main");
    const listButton = main.getByRole("button", { name: "List", exact: true });
    await expect(listButton).toHaveAttribute("aria-pressed", "true", {
      timeout: 60_000,
    });

    for (const name of ["Board", "List", "Spreadsheet", "Calendar", "Gantt"]) {
      // Only the tab spells the name out; the switch keeps it as its label.
      await expect(main.getByText(name, { exact: true })).toHaveCount(1);
    }

    await main.getByRole("button", { name: "Board", exact: true }).click();
    await expect(
      main.getByRole("button", { name: "Board", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("failed loads", () => {
  test("the board shows an error with a retry, then recovers", async ({
    api,
    page,
  }) => {
    const task = await createTask(api, project.id, {
      title: uniqueName("Back again"),
      status: "to-do",
    });
    const tasks = `**/api/task/tasks/${project.id}*`;
    await page.route(tasks, (route) =>
      route.fulfill({ status: 500, body: "boom" }),
    );
    await page.goto(boardPath(project.id));

    const retry = page
      .getByRole("main")
      .getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible({ timeout: 60_000 });

    await page.unroute(tasks);
    await retry.click();
    await expect(taskCard(page, task.title)).toBeVisible({ timeout: 60_000 });
    await expect(retry).toHaveCount(0);
  });

  test("the Gantt shows an error, not an empty project, then recovers", async ({
    page,
  }) => {
    const tasks = `**/api/task/tasks/${project.id}*`;
    await page.route(tasks, (route) =>
      route.fulfill({ status: 500, body: "boom" }),
    );
    await page.goto(projectViewPath(project.id, "gantt"));

    const retry = page
      .getByRole("main")
      .getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("No scheduled tasks")).toHaveCount(0);

    await page.unroute(tasks);
    await retry.click();
    await expect(page.getByText("No scheduled tasks")).toBeVisible({
      timeout: 60_000,
    });
  });

  test("Home does not say Caught up when the inbox count fails", async ({
    page,
    seed,
  }) => {
    const counts = "**/api/notification/counts*";
    await page.route(counts, (route) =>
      route.fulfill({ status: 500, body: "boom" }),
    );
    await page.goto(`/dashboard/workspace/${seed.workspace.id}`);

    const focus = page.getByRole("region", { name: "Jump back in" });
    const inbox = focus.getByRole("link", { name: /Inbox/ });
    await expect(inbox).toContainText("Couldn't load", { timeout: 60_000 });
    await expect(inbox).not.toContainText("All caught up");

    await page.unroute(counts);
    await focus.getByRole("button", { name: "Try again" }).click();
    await expect(inbox).not.toContainText("Couldn't load", { timeout: 60_000 });
  });
});

test.describe("board search and my tasks", () => {
  test("search has a visible control on a phone", async ({ api, page }) => {
    const found = await createTask(api, project.id, {
      title: uniqueName("Needle"),
      status: "to-do",
    });
    const other = await createTask(api, project.id, {
      title: uniqueName("Haystack"),
      status: "to-do",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);

    const main = page.getByRole("main");
    await main
      .getByRole("button", { name: "Search tasks", exact: true })
      .click();
    const field = main.getByRole("textbox", { name: "Search tasks" });
    await expect(field).toBeFocused();
    await field.fill(found.title);
    await expect(taskCard(page, found.title).first()).toBeVisible();
    await expect(taskCard(page, other.title)).toHaveCount(0);

    await field.fill("");
    await expect(taskCard(page, other.title).first()).toBeVisible();
  });

  test("My tasks takes one click, on and off", async ({ api, page, seed }) => {
    const mine = await createTask(api, project.id, {
      title: uniqueName("Mine"),
      status: "to-do",
      assigneeIds: [seed.users.owner.id],
    });
    const theirs = await createTask(api, project.id, {
      title: uniqueName("Theirs"),
      status: "to-do",
    });
    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);
    await expect(taskCard(page, theirs.title)).toBeVisible();

    const myTasks = page
      .getByRole("main")
      .getByRole("button", { name: "My tasks", exact: true });
    await myTasks.click();
    await expect(myTasks).toHaveAttribute("aria-pressed", "true");
    await expect(taskCard(page, theirs.title)).toHaveCount(0);
    await expect(taskCard(page, mine.title)).toBeVisible();

    await myTasks.click();
    await expect(myTasks).toHaveAttribute("aria-pressed", "false");
    await expect(taskCard(page, theirs.title)).toBeVisible();
  });
});
