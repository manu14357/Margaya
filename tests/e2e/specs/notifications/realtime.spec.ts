import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  createProject,
  createWorld,
  expectJson,
  type Project,
  type Task,
  type World,
} from "../../helpers/api-kit";
import {
  browserContextFor,
  openApp,
  UI_TIMEOUT,
} from "../../helpers/notifications";
import { uniqueName } from "../../helpers/ui";

// Realtime board updates over the project WebSocket: the owner and a member
// have the same board open; what the owner does appears on the member's
// board without a reload.

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Realtime");
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
  // Survives only as long as the page is not reloaded.
  await page.evaluate(() => {
    (window as unknown as { __e2eNoReload: boolean }).__e2eNoReload = true;
  });
}

/**
 * The board column headed `columnName` holding a card titled `title`. Columns
 * have no accessible name, so match the innermost block with both texts and
 * no other column's header.
 */
function cardInColumn(
  page: Page,
  columnName: string,
  title: string,
  otherColumns: string[],
) {
  let column = page
    .locator("div")
    .filter({ has: page.getByText(columnName, { exact: true }) })
    .filter({ has: page.getByText(title, { exact: true }) });
  for (const other of otherColumns) {
    column = column.filter({ hasNot: page.getByText(other, { exact: true }) });
  }
  return column.first();
}

const COLUMNS = ["To Do", "In Progress", "In Review", "Done"];
const others = (name: string) => COLUMNS.filter((column) => column !== name);

test("a task the owner creates and moves appears on the member's board without a reload", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const ownerContext = await browserContextFor(browser, world.users.owner);
  const memberContext = await browserContextFor(browser, world.users.member);
  try {
    const ownerPage = await ownerContext.newPage();
    const memberPage = await memberContext.newPage();
    await openBoard(ownerPage);
    await openBoard(memberPage);

    // The owner creates a task in the web app.
    const title = uniqueName("Live task");
    await ownerPage.getByRole("button", { name: "Add task" }).first().click();
    await ownerPage.getByPlaceholder("Task title").fill(title);
    await ownerPage.getByRole("button", { name: "Create task" }).click();
    await expect(ownerPage.getByText(title, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await expect(memberPage.getByText(title, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      cardInColumn(memberPage, "To Do", title, others("To Do")),
    ).toBeVisible();

    // The owner moves it to In Progress.
    const board = await expectJson<{
      data: {
        columns: { slug: string; tasks: Pick<Task, "id" | "title">[] }[];
      };
    }>(await world.as("owner").get(`/api/task/tasks/${project.id}`));
    const task = board.data.columns
      .flatMap((column) => column.tasks)
      .find((entry) => entry.title === title);
    expect(task).toBeTruthy();
    await expectJson(
      await world.as("owner").put(`/api/task/status/${task?.id}`, {
        data: { status: "in-progress" },
      }),
    );
    await expect(
      cardInColumn(memberPage, "In Progress", title, others("In Progress")),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      cardInColumn(memberPage, "To Do", title, others("To Do")),
    ).toHaveCount(0);

    // Renamed and then deleted by the owner: both reach the member too.
    const renamed = uniqueName("Live renamed");
    await expectJson(
      await world
        .as("owner")
        .put(`/api/task/title/${task?.id}`, { data: { title: renamed } }),
    );
    await expect(memberPage.getByText(renamed, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expectJson(await world.as("owner").delete(`/api/task/${task?.id}`));
    await expect(memberPage.getByText(renamed, { exact: true })).toBeHidden({
      timeout: 30_000,
    });

    const noReload = await memberPage.evaluate(
      () => (window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload,
    );
    expect(noReload).toBe(true);
  } finally {
    await ownerContext.close();
    await memberContext.close();
  }
});

test("a member of another workspace cannot subscribe to the board's WebSocket", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  // The project socket authorizes by workspace membership.
  const { signUpUser } = await import("../../helpers/api-kit");
  const outsider = await signUpUser("Realtime outsider");
  const context = await browserContextFor(browser, outsider);
  try {
    const page = await context.newPage();
    await openApp(page, "/");
    const outcome = await page.evaluate(async (projectId) => {
      return new Promise<string>((resolve) => {
        const socket = new WebSocket(`ws://localhost:3337/api/ws/${projectId}`);
        socket.onopen = () => {
          socket.close();
          resolve("open");
        };
        socket.onerror = () => resolve("error");
        setTimeout(() => resolve("timeout"), 5000);
      });
    }, project.id);
    expect(outcome).toBe("error");

    // A member's socket opens.
    const memberContext = await browserContextFor(browser, world.users.member);
    try {
      const memberPage = await memberContext.newPage();
      await openApp(memberPage, "/");
      const memberOutcome = await memberPage.evaluate(async (projectId) => {
        return new Promise<string>((resolve) => {
          const socket = new WebSocket(
            `ws://localhost:3337/api/ws/${projectId}`,
          );
          socket.onopen = () => {
            socket.close();
            resolve("open");
          };
          socket.onerror = () => resolve("error");
          setTimeout(() => resolve("timeout"), 5000);
        });
      }, project.id);
      expect(memberOutcome).toBe("open");
    } finally {
      await memberContext.close();
    }
  } finally {
    await context.close();
    await outsider.ctx.dispose();
  }
});
