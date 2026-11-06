import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";

// Runs only in the opt-in `phone` project: 360x740 with touch (E2E_PHONE=1).
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

const MAIN_VIEWS = [
  "backlog",
  "board",
  "spreadsheet",
  "calendar",
  "gantt",
  "cycles",
] as const;

type Seed = { workspace: { id: string }; projects: { web: { id: string } } };

function viewPath(seed: Seed, view: string): string {
  return `/dashboard/workspace/${seed.workspace.id}/project/${seed.projects.web.id}/${view}`;
}

function projectTabs(page: Page): Locator {
  return page.getByRole("navigation", { name: "Project sections" });
}

/**
 * A touch target's height, including its invisible ::after hit area. Measured
 * directly: a control in the toolbar's next wrapped row may sit under the reach.
 */
function hitAreaHeight(button: Locator) {
  return button.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element, "::after").height),
  );
}

for (const view of MAIN_VIEWS) {
  test(`the ${view} page fits a 360px screen`, async ({ page, seed }) => {
    await page.goto(viewPath(seed, view));
    await expect(projectTabs(page)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("the project tabs are 44px tall and scroll sideways", async ({
  page,
  seed,
}) => {
  await page.goto(viewPath(seed, "board"));
  const tabs = projectTabs(page);
  const board = tabs.getByRole("tab", { name: "Board", exact: true });
  await expect(board).toBeVisible();
  const box = await board.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);

  // A later tab starts off screen and can be scrolled to and tapped.
  const gantt = tabs.getByRole("tab", { name: "Gantt", exact: true });
  await gantt.scrollIntoViewIfNeeded();
  await gantt.tap();
  await expect(page).toHaveURL(/\/gantt/);
});

test("the spreadsheet's sticky column leaves room for the others", async ({
  page,
  seed,
}) => {
  await page.goto(viewPath(seed, "spreadsheet"));
  const first = page.getByRole("columnheader", { name: "Task", exact: true });
  await expect(first).toBeVisible();
  const box = await first.boundingBox();
  expect(box?.width).toBeLessThan(360 * 0.7);

  // The next column shows beside the sticky one, and scrolling brings a
  // later one into the visible part of the screen.
  const status = page.getByRole("columnheader", { name: "Status" });
  await expect(status).toBeInViewport();
  const priority = page.getByRole("columnheader", { name: "Priority" });
  await priority.scrollIntoViewIfNeeded();
  await expect(priority).toBeInViewport();
  const pinned = await first.boundingBox();
  expect(pinned?.x).toBe(box?.x);
});

test("calendar segments switch on tap and reach 44px", async ({
  page,
  seed,
}) => {
  await page.goto(viewPath(seed, "calendar"));
  const month = page.getByRole("button", { name: "Month", exact: true });
  const week = page.getByRole("button", { name: "Week", exact: true });
  await expect(month).toHaveAttribute("aria-pressed", "true");
  expect(await hitAreaHeight(week)).toBeGreaterThanOrEqual(44);

  await week.tap();
  await expect(week).toHaveAttribute("aria-pressed", "true");
  await expect(month).toHaveAttribute("aria-pressed", "false");

  await month.tap();
  await expect(month).toHaveAttribute("aria-pressed", "true");
  // The period stays readable on a phone.
  await expect(page.getByTestId("calendar-month-label")).toBeVisible();
});
