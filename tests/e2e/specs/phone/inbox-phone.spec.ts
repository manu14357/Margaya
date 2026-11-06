import type { Locator } from "@playwright/test";
import { asRole, expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  deleteProject,
  type TestProject,
} from "../../helpers/task-data";
import { closeMenus, escapeRegExp } from "../../helpers/task-ui";
import { uniqueName } from "../../helpers/ui";

// Runs only in the opt-in `phone` project: 360x740 with touch (E2E_PHONE=1).
test.describe.configure({ timeout: 180_000 });
test.use({ ...asRole("member"), navigationTimeout: 120_000 });

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Inbox phone") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

/** True when a tap `distance` px from the centre, on each side, lands on it. */
async function reaches(button: Locator, distance: number) {
  return button.evaluate((element, offset) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const points: [number, number][] = [
      [x, y - offset],
      [x, y + offset],
      [x - offset, y],
      [x + offset, y],
    ];
    return points.every(
      ([left, top]) => document.elementFromPoint(left, top) === element,
    );
  }, distance);
}

test("row actions and the reader work by touch at 360px", async ({
  page,
  api,
  seed,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Phone inbox"),
  });
  await api.patch(`/api/task/assignees/${task.id}`, {
    data: { add: [seed.users.member.id] },
  });

  await page.goto(`/dashboard/workspace/${seed.workspace.id}/inbox`);
  const list = page.getByRole("listbox", { name: "Notifications" });
  await expect(list).toBeVisible({ timeout: 60_000 });
  const row = list
    .getByRole("option", { name: new RegExp(escapeRegExp(task.title)) })
    .filter({ hasText: "assigned you" });
  // Notifications are written by an event handler; refresh until it lands.
  await expect(async () => {
    if (!(await row.isVisible())) {
      await page.getByRole("button", { name: "Refresh" }).tap();
    }
    await expect(row).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });

  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);

  // The actions are there with no hover, and each one has a full touch target.
  const markRead = row.getByRole("button", { name: "Mark as read" });
  const archive = row.getByRole("button", { name: "Archive" });
  const snooze = row.getByRole("button", { name: "Snooze" });
  await expect(markRead).toBeInViewport();
  const opacity = await archive.evaluate(
    (element) => getComputedStyle(element.parentElement as HTMLElement).opacity,
  );
  expect(opacity).toBe("1");
  await archive.scrollIntoViewIfNeeded();
  expect(await reaches(archive, 21)).toBe(true);

  // They act on the row without opening it.
  await markRead.tap();
  await expect(
    row.getByRole("button", { name: "Mark as unread" }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/notificationId=/);
  await snooze.tap();
  await expect(page.getByRole("menuitem", { name: /^1 day/ })).toBeVisible();
  await closeMenus(page);
  await expect(page).not.toHaveURL(/notificationId=/);

  // Opening the row swaps the list for the reader: the task first.
  await row.getByText(task.title).tap();
  await expect(list).toBeHidden();
  await expect(page.getByTitle(task.title)).toBeVisible();
  const properties = page.getByRole("region", { name: "Properties" });
  await expect(properties).toHaveCount(0);
  await page.getByRole("button", { name: /^Show properties/ }).tap();
  await expect(properties).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Back to notifications" }).tap();
  await expect(list).toBeVisible();
  await row.getByRole("button", { name: "Archive" }).tap();
  await expect(row).toHaveCount(0);
});
