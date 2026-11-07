import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import {
  createProject,
  createTask,
  dayOffset,
  deleteProject,
  getTask,
  isoDayOffset,
  projectViewPath,
  type TestProject,
  type TestTask,
} from "../../../helpers/task-data";
import { closeMenus, openFilterSubmenu, toast } from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;
let first: TestTask;
let second: TestTask;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Gantt links") });
  first = await createTask(api, project.id, {
    title: uniqueName("First"),
    startDate: isoDayOffset(0),
    dueDate: isoDayOffset(3),
  });
  second = await createTask(api, project.id, {
    title: uniqueName("Second"),
    startDate: isoDayOffset(10),
    dueDate: isoDayOffset(12),
  });
});

test.afterEach(async ({ api }) => {
  await deleteProject(api, project.id);
});

const barOf = (page: Page, task: TestTask) =>
  page.getByRole("button", { name: `${task.title}: open or drag to move` });

const hitLine = (page: Page) => page.getByTestId("gantt-dependency-hit");

const rowOf = (page: Page, task: TestTask) =>
  page.locator(`[data-gantt-row="${task.id}"]`);

/** Halfway along the line: the middle of its box may miss an elbow. */
function linePoint(page: Page) {
  return hitLine(page).evaluate((element) => {
    const path = element as unknown as SVGPathElement;
    const middle = path.getPointAtLength(path.getTotalLength() / 2);
    const onScreen = new DOMPoint(middle.x, middle.y).matrixTransform(
      path.getScreenCTM() ?? undefined,
    );
    return { x: onScreen.x, y: onScreen.y };
  });
}

async function clickLine(page: Page) {
  const point = await linePoint(page);
  await page.mouse.click(point.x, point.y);
}

async function openGantt(page: Page) {
  await page.goto(projectViewPath(project.id, "gantt"));
  await expect(barOf(page, first)).toBeVisible({ timeout: 30_000 });
  // The handles appear once the task:update check resolves.
  await expect(
    page.getByRole("button", { name: `Link ${first.title} to another task` }),
  ).toBeAttached({ timeout: 30_000 });
}

/** Presses a bar's link handle and holds it, for the pointer to draw from. */
async function pressHandle(page: Page, task: TestTask) {
  const bar = barOf(page, task);
  await bar.scrollIntoViewIfNeeded();
  await bar.hover();
  const handle = page.getByRole("button", {
    name: `Link ${task.title} to another task`,
  });
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error("the handle is not visible");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  return center;
}

/**
 * Draws from the first bar's handle and lets go on the second task's row. The
 * whole row takes the drop, which is how a bar past the edge of the screen gets
 * linked: at 1280px wide the second bar starts beyond the right edge.
 */
async function drawLink(page: Page) {
  const row = rowOf(page, second);
  const from = await pressHandle(page, first);
  const to = await row.boundingBox();
  if (!to) throw new Error("the target row is not visible");
  await page.mouse.move(from.x + 80, to.y + to.height / 2, { steps: 8 });
  await expect(row).toHaveAttribute("data-gantt-link-target", "");
  await expect(page.getByTestId("gantt-link-preview")).toBeVisible();
  await page.mouse.up();
}

function dependencies(api: APIRequestContext) {
  return api.get(`/api/task-relation/project/${project.id}`).then(
    (response) =>
      response.json() as Promise<{
        relations: { sourceTaskId: string; targetTaskId: string }[];
        blockedTaskIds: string[];
      }>,
  );
}

test("a line drawn between two bars links them, and the line removes it", async ({
  page,
  api,
}) => {
  await openGantt(page);
  await drawLink(page);

  await expect(hitLine(page)).toHaveCount(1);
  const { relations } = await dependencies(api);
  expect(relations).toEqual([
    expect.objectContaining({
      sourceTaskId: first.id,
      targetTaskId: second.id,
      relationType: "blocks",
    }),
  ]);

  await clickLine(page);
  await page.getByRole("button", { name: "Remove relation" }).click();
  await expect(hitLine(page)).toHaveCount(0);
  expect((await dependencies(api)).relations).toEqual([]);
});

test("a link can land on a row where another link's line runs", async ({
  page,
  api,
}) => {
  const another = await createTask(api, project.id, {
    title: uniqueName("Another"),
    startDate: isoDayOffset(1),
    dueDate: isoDayOffset(2),
  });
  await api.post("/api/task-relation", {
    data: {
      sourceTaskId: first.id,
      targetTaskId: second.id,
      relationType: "blocks",
    },
  });

  await openGantt(page);
  await expect(hitLine(page)).toHaveCount(1);
  // Along the middle of the second task's row, on the way to its bar.
  const onLine = await linePoint(page);
  const underPointer = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-testid"),
    onLine,
  );
  expect(underPointer).toBe("gantt-dependency-hit");

  await pressHandle(page, another);
  await page.mouse.move(onLine.x, onLine.y, { steps: 8 });
  await expect(rowOf(page, second)).toHaveAttribute(
    "data-gantt-link-target",
    "",
  );
  await page.mouse.up();

  await expect(hitLine(page)).toHaveCount(2);
  expect((await dependencies(api)).relations).toContainEqual(
    expect.objectContaining({
      sourceTaskId: another.id,
      targetTaskId: second.id,
    }),
  );
});

test("a line's popover fades in where it belongs, clear of both bars", async ({
  page,
  api,
}) => {
  await api.post("/api/task-relation", {
    data: {
      sourceTaskId: first.id,
      targetTaskId: second.id,
      relationType: "blocks",
    },
  });
  await openGantt(page);
  await expect(hitLine(page)).toHaveCount(1);
  const point = await linePoint(page);

  // The popover's box and opacity on every frame from the click on.
  await page.evaluate(() => {
    const frames: { x: number; y: number; opacity: number }[] = [];
    Object.assign(window, { linkPopoverFrames: frames });
    const started = performance.now();
    const tick = () => {
      const popup = document.querySelector("[data-testid=gantt-link-popover]");
      if (popup?.parentElement) {
        const box = popup.getBoundingClientRect();
        frames.push({
          x: box.left,
          y: box.top,
          opacity:
            Number(getComputedStyle(popup).opacity) *
            Number(getComputedStyle(popup.parentElement).opacity),
        });
      }
      if (performance.now() - started < 1000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.click(point.x, point.y);
  const popover = page.getByTestId("gantt-link-popover");
  await expect(popover).toBeVisible();
  await page.waitForTimeout(1000);
  const frames = await page.evaluate(
    () =>
      (
        window as unknown as {
          linkPopoverFrames: { x: number; y: number; opacity: number }[];
        }
      ).linkPopoverFrames,
  );

  // Every frame it shows on is at its spot, give or take the few pixels of
  // its entrance: it never travels there from the corner of the page.
  const shown = frames.filter((frame) => frame.opacity > 0.01);
  const last = shown.at(-1);
  expect(last).toBeDefined();
  for (const frame of shown) {
    expect(Math.abs(frame.x - (last?.x ?? 0))).toBeLessThan(8);
    expect(Math.abs(frame.y - (last?.y ?? 0))).toBeLessThan(8);
  }
  // And it fades in rather than appearing at full strength.
  expect(shown[0]?.opacity).toBeLessThan(1);

  const box = await popover.boundingBox();
  for (const task of [first, second]) {
    const bar = await barOf(page, task).boundingBox();
    if (!box || !bar) continue;
    const overlaps =
      box.x < bar.x + bar.width &&
      bar.x < box.x + box.width &&
      box.y < bar.y + bar.height &&
      bar.y < box.y + box.height;
    expect(overlaps, `the popover covers ${task.title}'s bar`).toBe(false);
  }
});

test("a line that can't be removed stays, and says so", async ({
  page,
  api,
}) => {
  await api.post("/api/task-relation", {
    data: {
      sourceTaskId: first.id,
      targetTaskId: second.id,
      relationType: "blocks",
    },
  });
  await page.route("**/api/task-relation/**", (route) =>
    route.request().method() === "DELETE" ? route.abort() : route.continue(),
  );

  await openGantt(page);
  await expect(hitLine(page)).toHaveCount(1);
  await clickLine(page);
  await page.getByRole("button", { name: "Remove relation" }).click();

  await expect(toast(page, "Couldn't remove the relation")).toBeVisible();
  await expect(hitLine(page)).toHaveCount(1);
});

test("a link that breaks the dates moves nothing until the preview is confirmed", async ({
  page,
  api,
}) => {
  // Starts before the first task ends.
  const overlapping = await createTask(api, project.id, {
    title: uniqueName("Overlapping"),
    startDate: isoDayOffset(1),
    dueDate: isoDayOffset(2),
  });
  await api.post("/api/task-relation", {
    data: {
      sourceTaskId: first.id,
      targetTaskId: overlapping.id,
      relationType: "blocks",
    },
  });

  await openGantt(page);
  await expect(hitLine(page)).toHaveCount(1);
  const before = await getTask(api, overlapping.id);

  await clickLine(page);
  await page.getByRole("button", { name: "Review date changes" }).click();
  const preview = page.getByTestId("gantt-cascade-preview");
  await expect(preview).toContainText(overlapping.title);

  await page.getByRole("button", { name: "Keep dates" }).click();
  await expect(preview).toBeHidden();
  expect((await getTask(api, overlapping.id)).startDate).toEqual(
    before.startDate,
  );

  await clickLine(page);
  await page.getByRole("button", { name: "Review date changes" }).click();
  await page.getByRole("button", { name: "Move 1 task" }).click();
  await expect
    .poll(async () => (await getTask(api, overlapping.id)).startDate)
    .not.toEqual(before.startDate);
});

test("a milestone added on the chart shows as a point and can be turned back", async ({
  page,
}) => {
  await openGantt(page);
  const title = uniqueName("Beta ships");

  await page.getByTestId("gantt-add-milestone").click();
  await page.getByRole("textbox", { name: "Milestone name" }).fill(title);
  await page.getByLabel("Milestone date").fill(dayOffset(5));
  await page.getByRole("button", { name: "Add milestone" }).click();

  const milestone = page.getByRole("button", {
    name: `Milestone ${title}: open or drag to move`,
  });
  await expect(milestone).toBeVisible();

  await milestone.click();
  const toggle = page.getByRole("switch", { name: "Milestone" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: `${title}: open or drag to move`,
      exact: true,
    }),
  ).toBeVisible();
});

test("the blocked filter keeps blocked tasks, and blocking stops nothing", async ({
  page,
  api,
}) => {
  await api.post("/api/task-relation", {
    data: {
      sourceTaskId: first.id,
      targetTaskId: second.id,
      relationType: "blocks",
    },
  });

  await openGantt(page);
  const submenu = await openFilterSubmenu(page, "Blocked");
  const yes = submenu.getByRole("button", { name: "Yes" });
  await yes.click();
  await expect(yes).toHaveAttribute("aria-pressed", "true");
  await closeMenus(page);

  await expect(barOf(page, second)).toBeVisible();
  await expect(barOf(page, first)).toHaveCount(0);

  // The task can still change status while blocked.
  const moved = await api.put(`/api/task/status/${second.id}`, {
    data: { status: "done" },
  });
  expect(moved.ok()).toBe(true);
  expect((await dependencies(api)).blockedTaskIds).toEqual([]);
});
