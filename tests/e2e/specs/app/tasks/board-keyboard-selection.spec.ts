import type { Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import {
  boardPath,
  createProject,
  createTask,
  deleteProject,
  type TestProject,
  type TestTask,
} from "../../../helpers/task-data";
import { taskCard, waitForBoardReady } from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;
let first: TestTask;
let second: TestTask;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Card keys") });
  first = await createTask(api, project.id, {
    title: uniqueName("First card"),
    status: "to-do",
  });
  second = await createTask(api, project.id, {
    title: uniqueName("Second card"),
    status: "to-do",
  });
});

test.afterEach(async ({ api }) => {
  await deleteProject(api, project.id);
});

const cardById = (page: Page, id: string) =>
  page.locator(`[data-board-card="${id}"]`);

test("a visible checkbox selects a card without opening it", async ({
  page,
}) => {
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);

  const card = taskCard(page, first.title);
  const checkbox = page.getByRole("checkbox", {
    name: new RegExp(first.title),
  });

  await card.hover();
  await expect(checkbox).toBeVisible();
  await checkbox.click();

  await expect(checkbox).toBeChecked();
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(page).not.toHaveURL(/taskId=/);

  // With a selection under way, every card keeps its control in view.
  await page.mouse.move(0, 0);
  const otherControl = cardById(page, second.id).locator(
    "[data-selection-control]",
  );
  await expect(otherControl).toHaveCSS("opacity", "1");

  await page.keyboard.press("Escape");
  await expect(page.getByText("1 selected")).toBeHidden();
  await expect(otherControl).toHaveCSS("opacity", "0");
});

test("the keyboard moves between cards, selects and opens them", async ({
  page,
}) => {
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);

  await page.locator("body").click({ position: { x: 1, y: 1 } });

  // Walking the board never opens a task.
  await page.keyboard.press("j");
  const focusedId = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-board-card"),
  );
  expect([first.id, second.id]).toContain(focusedId);
  await expect(page).not.toHaveURL(/taskId=/);

  await page.keyboard.press("ArrowDown");
  const movedId = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-board-card"),
  );
  expect([first.id, second.id]).toContain(movedId);
  expect(movedId).not.toBe(focusedId);

  await page.keyboard.press("x");
  await expect(
    cardById(page, movedId ?? "").locator("[data-selected]"),
  ).toBeVisible();
  await page.keyboard.press("x");
  await expect(
    cardById(page, movedId ?? "").locator("[data-selected]"),
  ).toBeHidden();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`taskId=${movedId}`));
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("the checkbox shows without hovering and selects on tap", async ({
    page,
  }) => {
    await page.goto(boardPath(project.id));
    await waitForBoardReady(page);

    const checkbox = page.getByRole("checkbox", {
      name: new RegExp(first.title),
    });
    await expect(
      cardById(page, first.id).locator("[data-selection-control]"),
    ).toHaveCSS("opacity", "1");

    await checkbox.tap();
    await expect(checkbox).toBeChecked();
    await expect(page.getByText("1 selected")).toBeVisible();
    await expect(page).not.toHaveURL(/taskId=/);
  });
});
