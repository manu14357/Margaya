import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  type Project,
  type World,
} from "../../helpers/api-kit";
import {
  browserContextFor,
  openApp,
  UI_TIMEOUT,
} from "../../helpers/notifications";
import { uniqueName } from "../../helpers/ui";

// How often an open board reloads its tasks. With a live project socket it
// waits for changes instead of polling; with the socket down, polling keeps it
// current. Either way a colleague's change reaches the board.

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Board refresh");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

const boardPath = () =>
  `/dashboard/workspace/${world.workspace.id}/project/${project.id}/board`;

async function openBoard(page: Page) {
  await openApp(page, boardPath());
  await expect(
    page.getByRole("button", { name: "Add task" }).first(),
  ).toBeVisible({ timeout: UI_TIMEOUT });
}

/** Counts board reload requests from here on. */
function countBoardRequests(page: Page) {
  let count = 0;
  page.on("request", (request) => {
    if (request.url().includes(`/api/task/tasks/${project.id}`)) count++;
  });
  return { value: () => count, reset: () => (count = 0) };
}

test("a live board does not poll, and a burst of edits reaches it in few reloads", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const tasks = [];
  for (let index = 0; index < 12; index++) {
    tasks.push(
      await createTask(world.as("owner"), project.id, {
        title: uniqueName(`Burst ${index}`),
      }),
    );
  }

  const context = await browserContextFor(browser, world.users.member);
  try {
    const page = await context.newPage();
    const socketOpened = page.waitForEvent("websocket", {
      predicate: (socket) => socket.url().includes(`/api/ws/${project.id}`),
      timeout: UI_TIMEOUT,
    });
    await openBoard(page);
    await socketOpened;
    for (const task of tasks) {
      await expect(page.getByText(task.title, { exact: true })).toBeVisible({
        timeout: UI_TIMEOUT,
      });
    }

    const requests = countBoardRequests(page);
    // Longer than the 30 seconds it used to poll at.
    await page.waitForTimeout(40_000);
    expect(requests.value()).toBe(0);

    const renames = tasks.map(() => uniqueName("Renamed in a burst"));
    await Promise.all(
      tasks.map(async (task, index) =>
        expectJson(
          await world.as("owner").put(`/api/task/title/${task.id}`, {
            data: { title: renames[index] },
          }),
        ),
      ),
    );
    for (const title of renames) {
      await expect(page.getByText(title, { exact: true })).toBeVisible({
        timeout: 30_000,
      });
    }
    // One board page per reload here; twelve messages must not mean twelve.
    expect(requests.value()).toBeLessThan(6);
  } finally {
    await context.close();
  }
});

test("with the project socket down, polling still brings in a colleague's change", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const task = await createTask(world.as("owner"), project.id, {
    title: uniqueName("Poll me"),
  });

  const context = await browserContextFor(browser, world.users.member);
  try {
    const page = await context.newPage();
    await page.routeWebSocket(`**/api/ws/${project.id}**`, (socket) =>
      socket.close(),
    );
    await openBoard(page);
    await expect(page.getByText(task.title, { exact: true })).toBeVisible({
      timeout: UI_TIMEOUT,
    });

    const renamed = uniqueName("Seen by polling");
    await expectJson(
      await world
        .as("owner")
        .put(`/api/task/title/${task.id}`, { data: { title: renamed } }),
    );
    await expect(page.getByText(renamed, { exact: true })).toBeVisible({
      timeout: 45_000,
    });
  } finally {
    await context.close();
  }
});
