import type { APIRequestContext, Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { readJson } from "../../../helpers/http";
import { uniqueName } from "../../../helpers/ui";
import { createProjectViaApi, deleteProjectViaApi } from "../core/_support";
import { expect, projectPath } from "./_support";

// The calendar's month and week views on touch screens: a compact overview of
// days plus an agenda for the selected day, with "Move to date" in place of
// dragging. With a mouse at desktop width both keep their bars.

test.describe.configure({ timeout: 120_000 });

const ORIGIN = { Origin: E2E_WEB_URL };

/** Two days of the current month, so the calendar opens on both. */
function monthDays() {
  const now = new Date();
  const day = (date: number) =>
    new Date(now.getFullYear(), now.getMonth(), date);
  return { first: day(10), second: day(20) };
}

/** How the app names a day: "Tuesday, November 10". */
function dayName(day: Date): string {
  return day.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** The start of the date picker's name for a day: "Friday, November 20". */
function pickerDayPrefix(day: Date): string {
  const weekday = day.toLocaleDateString("en-US", { weekday: "long" });
  const month = day.toLocaleDateString("en-US", { month: "long" });
  return `${weekday}, ${month} ${day.getDate()}`;
}

function dayCell(page: Page, day: Date) {
  return page.getByRole("button", {
    name: new RegExp(`^${dayName(day)}, (\\d+ tasks?|no tasks)$`),
  });
}

async function createDatedTask(
  api: APIRequestContext,
  projectId: string,
  title: string,
  due: Date,
): Promise<{ id: string }> {
  return readJson(
    await api.post(`${E2E_API_URL}/api/task/${projectId}`, {
      data: {
        title,
        description: "",
        priority: "high",
        status: "to-do",
        dueDate: due.toISOString(),
      },
      headers: ORIGIN,
    }),
    `create task ${title}`,
  );
}

/** A local day from its `yyyy-MM-dd` key. */
function fromKey(key: string): Date {
  const [year = 0, month = 1, date = 1] = key.split("-").map(Number);
  return new Date(year, month - 1, date);
}

/**
 * Switches the calendar to Week, runs `run` with the week's days, then puts
 * the owner's synced choice back to Month for the specs that follow.
 */
async function inWeekView(
  page: Page,
  api: APIRequestContext,
  path: string,
  run: (days: Date[]) => Promise<void>,
) {
  await page.goto(path);
  const week = page.getByRole("button", { name: "Week", exact: true });
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/api/user/preferences") &&
      response.request().method() === "PATCH",
  );
  await week.click();
  await expect(week).toHaveAttribute("aria-pressed", "true");
  await saved;
  try {
    const keys = await page
      .locator("[data-calendar-day]")
      .evaluateAll((days) =>
        days.map((day) => day.getAttribute("data-calendar-day") ?? ""),
      );
    await run(keys.map(fromKey));
  } finally {
    // Leaving the page flushes any pending preference write first.
    await page.goto("about:blank");
    await readJson(
      await api.patch(`${E2E_API_URL}/api/user/preferences`, {
        data: { calendarMode: "month" },
        headers: ORIGIN,
      }),
      "restore the month view",
    );
  }
}

/** Two days of the strip in one month, so the date picker shows both. */
function twoDaysOf(days: Date[]): { first: Date; second: Date } {
  const months = new Map<number, Date[]>();
  for (const day of days) {
    months.set(day.getMonth(), [...(months.get(day.getMonth()) ?? []), day]);
  }
  const [busiest] = [...months.values()].sort(
    (left, right) => right.length - left.length,
  );
  const first = busiest?.[0];
  const second = busiest?.at(-1);
  if (!first || !second) throw new Error("The week view shows no days");
  return { first, second };
}

async function withProject(
  api: APIRequestContext,
  workspaceId: string,
  run: (project: { id: string; slug: string }) => Promise<void>,
) {
  const project = await createProjectViaApi(api, workspaceId, {
    name: uniqueName("Calendar touch"),
  });
  try {
    await run(project);
  } finally {
    await deleteProjectViaApi(api, project.id);
  }
}

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("tap a day, open, add and move tasks from its agenda", async ({
    page,
    api,
    seed,
  }) => {
    await withProject(api, seed.workspace.id, async (project) => {
      const { first, second } = monthDays();
      const title = uniqueName("Calendar task");
      const task = await createDatedTask(api, project.id, title, first);

      await page.goto(projectPath(project.id, "calendar"));
      await expect(dayCell(page, first)).toHaveAccessibleName(
        `${dayName(first)}, 1 task`,
      );
      // The bars are a desktop-only layout.
      await expect(
        page.getByRole("button", {
          name: new RegExp(`^${title}, .*open task`),
        }),
      ).toHaveCount(0);

      // Tap a day: it is selected and its agenda lists the task.
      await dayCell(page, first).tap();
      await expect(dayCell(page, first)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(
        page.getByRole("heading", { name: dayName(first) }),
      ).toBeVisible();
      await expect(page).toHaveURL(/[?&]day=\d{4}-\d{2}-\d{2}/);
      const row = page.getByRole("button", {
        name: new RegExp(`^${title}`),
      });
      await expect(row).toContainText(`${project.slug}-1`);
      await expect(row).toContainText("To Do");

      // Open the task; closing it keeps the selected day.
      await row.tap();
      await expect(
        page.getByRole("dialog", { name: "Task details" }),
      ).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`taskId=${task.id}`));
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("dialog", { name: "Task details" }),
      ).toHaveCount(0);
      await expect(page).toHaveURL(/[?&]day=/);
      await expect(dayCell(page, first)).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      // Add a task due that day with the quick add.
      const added = uniqueName("Added on touch");
      await page.getByRole("button", { name: "Add task", exact: true }).tap();
      const capture = page.getByLabel(`Add task due ${dayName(first)}`);
      await capture.fill(added);
      await capture.press("Enter");
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: new RegExp(`^${added}`) }),
      ).toBeVisible();
      await expect(dayCell(page, first)).toHaveAccessibleName(
        `${dayName(first)}, 2 tasks`,
      );

      // Move the first task to another day.
      await page
        .getByRole("button", { name: `Move ${title} to another date` })
        .tap();
      const dialog = page.getByRole("dialog", { name: "Move to date" });
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", {
          // react-day-picker names days "Friday, November 20th, 2026".
          name: new RegExp(`^${pickerDayPrefix(second)}(st|nd|rd|th),`),
        })
        .tap();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(`Moved to ${dayName(second)}`)).toBeVisible();
      await expect(row).toHaveCount(0);
      await expect(dayCell(page, second)).toHaveAccessibleName(
        `${dayName(second)}, 1 task`,
      );

      await dayCell(page, second).tap();
      await expect(row).toBeVisible();

      const saved = await readJson<{ dueDate: string | null }>(
        await api.get(`${E2E_API_URL}/api/task/${task.id}`),
        "read moved task",
      );
      expect(new Date(saved.dueDate ?? "").getDate()).toBe(second.getDate());
    });
  });

  test("an empty day shows its empty state", async ({ page, api, seed }) => {
    await withProject(api, seed.workspace.id, async (project) => {
      const { first } = monthDays();
      await page.goto(projectPath(project.id, "calendar"));
      await dayCell(page, first).tap();
      await expect(
        page.getByRole("heading", { name: dayName(first) }),
      ).toBeVisible();
      await expect(page.getByText("No tasks on this day.")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Add task", exact: true }),
      ).toBeVisible();
    });
  });
});

test.describe("on a touch tablet", () => {
  test.use({
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    isMobile: true,
  });

  test("the day cells and agenda replace the bars", async ({
    page,
    api,
    seed,
  }) => {
    await withProject(api, seed.workspace.id, async (project) => {
      const { first } = monthDays();
      const title = uniqueName("Tablet task");
      await createDatedTask(api, project.id, title, first);

      await page.goto(projectPath(project.id, "calendar"));
      await dayCell(page, first).tap();
      await expect(
        page.getByRole("button", { name: new RegExp(`^${title}`) }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: `Move ${title} to another date` }),
      ).toBeVisible();
    });
  });
});

test.describe("with a mouse at desktop width", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the month keeps its bars and has no agenda", async ({
    page,
    api,
    seed,
  }) => {
    await withProject(api, seed.workspace.id, async (project) => {
      const { first } = monthDays();
      const title = uniqueName("Desktop task");
      await createDatedTask(api, project.id, title, first);

      await page.goto(projectPath(project.id, "calendar"));
      await expect(
        page.getByRole("button", {
          name: new RegExp(`^${title}, .*open task`),
        }),
      ).toBeVisible();
      await expect(dayCell(page, first)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Add task", exact: true }),
      ).toHaveCount(0);
    });
  });
});

test.describe("the week view on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("a strip of days with the agenda: open, add, move, change week", async ({
    page,
    api,
    seed,
  }) => {
    await withProject(api, seed.workspace.id, async (project) => {
      await inWeekView(
        page,
        api,
        projectPath(project.id, "calendar"),
        async (days) => {
          expect(days).toHaveLength(7);
          await expect(
            page.locator("[data-calendar-region=compact-week]"),
          ).toBeVisible();
          // Every day is a 44px target or larger.
          for (const day of days) {
            const box = await dayCell(page, day).boundingBox();
            expect(box?.width).toBeGreaterThanOrEqual(44);
            expect(box?.height).toBeGreaterThanOrEqual(44);
          }

          const { first, second } = twoDaysOf(days);
          const title = uniqueName("Week task");
          const task = await createDatedTask(api, project.id, title, first);
          await page.reload();
          await expect(dayCell(page, first)).toHaveAccessibleName(
            `${dayName(first)}, 1 task`,
          );
          await expect(
            page.getByRole("button", {
              name: new RegExp(`^${title}, .*open task`),
            }),
          ).toHaveCount(0);

          // Tap a day: it is selected, kept in the URL, and its agenda lists
          // the task.
          await dayCell(page, first).tap();
          await expect(dayCell(page, first)).toHaveAttribute(
            "aria-pressed",
            "true",
          );
          await expect(
            page.getByRole("heading", { name: dayName(first) }),
          ).toBeVisible();
          await expect(page).toHaveURL(/[?&]day=\d{4}-\d{2}-\d{2}/);
          const row = page.getByRole("button", {
            name: new RegExp(`^${title}`),
          });
          await expect(row).toContainText(`${project.slug}-1`);

          await row.tap();
          await expect(
            page.getByRole("dialog", { name: "Task details" }),
          ).toBeVisible();
          await expect(page).toHaveURL(new RegExp(`taskId=${task.id}`));
          await page.keyboard.press("Escape");
          await expect(
            page.getByRole("dialog", { name: "Task details" }),
          ).toHaveCount(0);
          await expect(dayCell(page, first)).toHaveAttribute(
            "aria-pressed",
            "true",
          );

          const added = uniqueName("Added in week");
          await page
            .getByRole("button", { name: "Add task", exact: true })
            .tap();
          const capture = page.getByLabel(`Add task due ${dayName(first)}`);
          await capture.fill(added);
          await capture.press("Enter");
          await page.keyboard.press("Escape");
          await expect(
            page.getByRole("button", { name: new RegExp(`^${added}`) }),
          ).toBeVisible();
          await expect(dayCell(page, first)).toHaveAccessibleName(
            `${dayName(first)}, 2 tasks`,
          );

          await page
            .getByRole("button", { name: `Move ${title} to another date` })
            .tap();
          const dialog = page.getByRole("dialog", { name: "Move to date" });
          await dialog
            .getByRole("button", {
              name: new RegExp(`^${pickerDayPrefix(second)}(st|nd|rd|th),`),
            })
            .tap();
          await expect(dialog).toHaveCount(0);
          await expect(
            page.getByText(`Moved to ${dayName(second)}`),
          ).toBeVisible();
          await expect(row).toHaveCount(0);
          await expect(dayCell(page, second)).toHaveAccessibleName(
            `${dayName(second)}, 1 task`,
          );
          await dayCell(page, second).tap();
          await expect(row).toBeVisible();

          // The next week starts from its first day, and the URL drops the
          // old one.
          await page.getByRole("button", { name: "Next week" }).tap();
          await expect(dayCell(page, second)).toHaveCount(0);
          await expect(page).not.toHaveURL(/[?&]day=/);
          const nextFirst = new Date(days[0] ?? Date.now());
          nextFirst.setDate(nextFirst.getDate() + 7);
          await expect(dayCell(page, nextFirst)).toHaveAttribute(
            "aria-pressed",
            "true",
          );

          await page.getByRole("button", { name: "Today", exact: true }).tap();
          await expect(dayCell(page, new Date())).toHaveAttribute(
            "aria-pressed",
            "true",
          );
        },
      );
    });
  });
});

test.describe("the week view on a touch tablet", () => {
  test.use({
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    isMobile: true,
  });

  test("the strip and agenda replace the bars", async ({ page, api, seed }) => {
    await withProject(api, seed.workspace.id, async (project) => {
      await inWeekView(
        page,
        api,
        projectPath(project.id, "calendar"),
        async (days) => {
          const { first } = twoDaysOf(days);
          const title = uniqueName("Tablet week task");
          await createDatedTask(api, project.id, title, first);
          await page.reload();
          await dayCell(page, first).tap();
          await expect(
            page.getByRole("button", { name: new RegExp(`^${title}`) }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", {
              name: `Move ${title} to another date`,
            }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", {
              name: new RegExp(`^${title}, .*open task`),
            }),
          ).toHaveCount(0);
        },
      );
    });
  });
});

test.describe("the week view with a mouse at desktop width", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the week keeps its bars and has no agenda", async ({
    page,
    api,
    seed,
  }) => {
    await withProject(api, seed.workspace.id, async (project) => {
      const title = uniqueName("Desktop week task");
      await createDatedTask(api, project.id, title, new Date());
      await inWeekView(
        page,
        api,
        projectPath(project.id, "calendar"),
        async () => {
          await expect(
            page.getByRole("button", {
              name: new RegExp(`^${title}, .*open task`),
            }),
          ).toBeVisible();
          await expect(dayCell(page, new Date())).toHaveCount(0);
          await expect(
            page.locator("[data-calendar-region=compact-week]"),
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "Add task", exact: true }),
          ).toHaveCount(0);
        },
      );
    });
  });
});
