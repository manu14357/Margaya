import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { readJson } from "../../../helpers/http";
import {
  boardPath,
  createProject,
  createTask,
  createView,
  deleteProject,
  deleteView,
  listViews,
  projectViewPath,
  type TestProject,
  type TestTask,
  type TestView,
} from "../../../helpers/task-data";
import {
  closeMenus,
  escapeRegExp,
  openFilterSubmenu,
  taskCard,
  toast,
  waitForBoardReady,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;
let urgent: TestTask;
let low: TestTask;
let medium: TestTask;
const extraViews: string[] = [];

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Saved views") });
  urgent = await createTask(api, project.id, {
    title: uniqueName("Urgent item"),
    priority: "urgent",
  });
  low = await createTask(api, project.id, {
    title: uniqueName("Low item"),
    priority: "low",
  });
  medium = await createTask(api, project.id, {
    title: uniqueName("Medium item"),
    priority: "medium",
  });
});

test.afterEach(async ({ api }) => {
  for (const id of extraViews.splice(0)) await deleteView(api, id);
  if (project) await deleteProject(api, project.id);
});

function viewsPath() {
  return projectViewPath(project.id, "board").replace(/\/board$/, "/views");
}

async function openViewPage(page: Page, view: TestView) {
  await page.goto(`${viewsPath()}/${view.id}`);
  await expect(page.getByRole("button", { name: "View actions" })).toBeVisible({
    timeout: 60_000,
  });
}

async function viewRoot(page: Page) {
  return page.getByRole("main");
}

test("a filtered board is saved as a project view", async ({ page, api }) => {
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);

  const submenu = await openFilterSubmenu(page, "Priority");
  await submenu.getByRole("button", { name: /Urgent$/ }).click();
  await closeMenus(page);
  await expect(taskCard(page, low.title)).toHaveCount(0);

  await page.getByRole("button", { name: "Save view" }).click();
  const dialog = page.getByRole("dialog", { name: "New view" });
  await expect(
    dialog.getByRole("checkbox", { name: "Start from the current filters" }),
  ).toBeChecked();
  await expect(dialog.getByText("1 filters · grouped by Status")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /^Workspace/ })).toBeChecked();

  // The name is required.
  await dialog.getByRole("button", { name: "Create view" }).click();
  await expect(dialog.getByText("Give the view a name")).toBeVisible();

  await dialog.getByLabel("Name").fill("Urgent work");
  await dialog.getByLabel("Description").fill("Only the fires.");
  await dialog.getByRole("button", { name: "Create view" }).click();
  await expect(toast(page, "View created")).toBeVisible();
  await expect(page).toHaveURL(/\/views\/[^/]+$/);

  const main = await viewRoot(page);
  await expect(main.getByRole("button", { name: "Urgent work" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Priority is" })).toHaveText(
    "Urgent",
  );
  await expect(main.getByText("1 task", { exact: true })).toBeVisible();
  await expect(taskCard(main, urgent.title).first()).toBeVisible();
  await expect(taskCard(main, low.title)).toHaveCount(0);

  const views = await listViews(api, project.id);
  expect(views.map((view) => view.name)).toEqual(["Urgent work"]);
  expect(views[0]?.access).toBe("workspace");

  // The Views tab lists it.
  await page.goto(viewsPath());
  await expect(page.getByRole("button", { name: "Urgent work" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Everyone in the workspace can see it" }),
  ).toBeVisible();
});

test("changing a view offers Save, Save as new view and Reset", async ({
  page,
  api,
}) => {
  const view = await createView(api, {
    name: "Hot list",
    projectId: project.id,
    conditions: [{ key: "priority", operator: "in", values: ["urgent"] }],
  });
  await openViewPage(page, view);
  const main = await viewRoot(page);
  await expect(main.getByText("1 task", { exact: true })).toBeVisible();
  await expect(main.getByText("Unsaved changes")).toHaveCount(0);

  let submenu = await openFilterSubmenu(page, "Priority");
  await submenu.getByRole("button", { name: /Low$/ }).click();
  await closeMenus(page);
  await expect(main.getByText("2 tasks", { exact: true })).toBeVisible();
  await expect(main.getByText("Unsaved changes")).toBeVisible();

  // Reset goes back to the saved filters.
  await main.getByRole("button", { name: "Reset" }).click();
  await expect(main.getByText("1 task", { exact: true })).toBeVisible();
  await expect(main.getByText("Unsaved changes")).toHaveCount(0);

  // Save stores the change.
  submenu = await openFilterSubmenu(page, "Priority");
  await submenu.getByRole("button", { name: /Low$/ }).click();
  await closeMenus(page);
  await main.getByRole("button", { name: "Save", exact: true }).click();
  await expect(toast(page, "View saved")).toBeVisible();
  await expect(main.getByText("Unsaved changes")).toHaveCount(0);
  await page.reload();
  await expect(main.getByText("2 tasks", { exact: true })).toBeVisible();
  await expect(taskCard(main, low.title).first()).toBeVisible();
  const saved = await readJson<{ filters: unknown }>(
    await api.get(`/api/view/${view.id}`),
    "get view",
  );
  expect(JSON.stringify(saved.filters)).toContain("low");

  // Save as new view keeps the original.
  submenu = await openFilterSubmenu(page, "Priority");
  await submenu.getByRole("button", { name: /Medium$/ }).click();
  await closeMenus(page);
  await main.getByRole("button", { name: "Save as new view" }).click();
  const dialog = page.getByRole("dialog", { name: "New view" });
  await dialog.getByLabel("Name").fill("Hot and warm");
  await dialog.getByRole("button", { name: "Create view" }).click();
  await expect(toast(page, "View created")).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Hot and warm" }),
  ).toBeVisible();
  await expect(main.getByText("3 tasks", { exact: true })).toBeVisible();
  await expect(taskCard(main, medium.title).first()).toBeVisible();

  const names = (await listViews(api, project.id)).map((v) => v.name).sort();
  expect(names).toEqual(["Hot and warm", "Hot list"]);
});

test("views are duplicated, locked, edited and deleted from their menu", async ({
  page,
  api,
}) => {
  await createView(api, {
    name: "Team board",
    projectId: project.id,
    conditions: [{ key: "priority", operator: "in", values: ["urgent"] }],
  });
  await page.goto(viewsPath());
  const row = (name: string) =>
    page
      .getByRole("button", { name, exact: true })
      .locator("xpath=ancestor::*[.//button[@aria-label='View actions']][1]");
  /**
   * Runs a row menu item. The list re-renders on live updates, which can close
   * an open menu, so this retries until `done` holds (never re-running an
   * action whose result already shows).
   */
  const runMenuItem = async (name: string, item: string, done: Locator) => {
    await expect(async () => {
      if (await done.isVisible()) return;
      const menu = page.getByRole("menu", { name: "View actions" });
      if (!(await menu.isVisible())) {
        await row(name).getByRole("button", { name: "View actions" }).click();
      }
      await menu
        .getByRole("menuitem", { name: item, exact: true })
        .click({ timeout: 3_000 });
      await expect(done).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
  };
  /** Opens a row's "View actions" menu, retrying until it shows. */
  const openActions = async (name: string) => {
    const menu = page.getByRole("menu", { name: "View actions" });
    await expect(async () => {
      if (!(await menu.isVisible())) {
        await row(name).getByRole("button", { name: "View actions" }).click();
      }
      await expect(menu).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    return menu;
  };
  await expect(
    page.getByRole("button", { name: "Team board", exact: true }),
  ).toBeVisible({
    timeout: 60_000,
  });

  // Duplicate: the copy opens.
  await runMenuItem(
    "Team board",
    "Duplicate",
    page.getByRole("button", { name: "Team board (copy)", exact: true }),
  );
  await expect(page).toHaveURL(/\/views\/[^/]+$/);
  await page.goto(viewsPath());
  await expect(
    page.getByRole("button", { name: "Team board (copy)", exact: true }),
  ).toBeVisible({ timeout: 60_000 });

  // Lock: a locked view can't be deleted until unlocked.
  const locked = row("Team board").getByRole("img", { name: "Locked" });
  await runMenuItem("Team board", "Lock", locked);
  const menu = await openActions("Team board");
  // Disabled items keep their hint in a tooltip, outside the menu's tree.
  await expect(page.getByRole("menuitem", { name: /^Delete/ })).toBeDisabled();
  await expect(
    menu.getByRole("menuitem", { name: "Unlock", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(async () => {
    if ((await locked.count()) === 0) return;
    const open = page.getByRole("menu", { name: "View actions" });
    if (!(await open.isVisible())) {
      await row("Team board")
        .getByRole("button", { name: "View actions" })
        .click();
    }
    await open
      .getByRole("menuitem", { name: "Unlock", exact: true })
      .click({ timeout: 3_000 });
    await expect(locked).toHaveCount(0, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });

  // Edit: rename and make it private. Live updates can re-render the list
  // and detach the open menu, so the item is retried until the dialog shows.
  const dialog = page.getByRole("dialog", { name: "Edit view" });
  await runMenuItem("Team board (copy)", "Edit", dialog);
  await dialog.getByLabel("Name").fill("My copy");
  await dialog.getByRole("radio", { name: /^Private/ }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(toast(page, "View saved")).toBeVisible();
  // Saving opens the edited view; its header shows the new name.
  await expect(
    page
      .getByRole("main")
      .getByRole("button", { name: "My copy", exact: true }),
  ).toBeVisible();
  await page.goto(viewsPath());
  await expect(
    row("My copy").getByRole("img", { name: "Only you can see it" }),
  ).toBeVisible({
    timeout: 60_000,
  });

  // Delete
  const confirm = page.getByRole("alertdialog", { name: "Delete view?" });
  await runMenuItem("My copy", "Delete", confirm);
  await expect(confirm).toContainText("“My copy” will be deleted for everyone");
  await confirm.getByRole("button", { name: "Delete view" }).click();
  await expect(toast(page, "View deleted")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "My copy", exact: true }),
  ).toHaveCount(0);

  expect((await listViews(api, project.id)).map((view) => view.name)).toEqual([
    "Team board",
  ]);
});

test("a private view stays private and the list filters by owner and name", async ({
  page,
  api,
  apiAs,
  pageAs,
}) => {
  const shared = await createView(api, {
    name: "Shared triage",
    projectId: project.id,
  });
  const secret = await createView(api, {
    name: "Owner private",
    projectId: project.id,
    access: "private",
  });
  const memberView = await createView(await apiAs("member"), {
    name: "Member picks",
    projectId: project.id,
  });
  extraViews.push(memberView.id);

  // The member sees the shared views but not the owner's private one.
  const member = await pageAs("member");
  await member.goto(viewsPath());
  await expect(
    member.getByRole("button", { name: "Shared triage", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    member.getByRole("button", { name: "Member picks", exact: true }),
  ).toBeVisible();
  await expect(
    member.getByRole("button", { name: "Owner private", exact: true }),
  ).toHaveCount(0);
  await member.goto(`${viewsPath()}/${secret.id}`);
  await expect(
    member.getByText("This view doesn't exist or is private"),
  ).toBeVisible();

  // The owner filters the list to their own views and by name.
  await page.goto(viewsPath());
  await expect(
    page.getByRole("button", { name: "Member picks", exact: true }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Mine", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Member picks", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Owner private", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Shared triage", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("textbox", { name: "Search views" }).fill("triage");
  await expect(
    page.getByRole("button", { name: "Shared triage", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Owner private", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search views" }).fill("zzz-none");
  await expect(page.getByText("No views match “zzz-none”")).toBeVisible();
  void shared;
});

test("a view's layout switches between list, board and spreadsheet", async ({
  page,
  api,
}) => {
  const view = await createView(api, {
    name: "Layouts",
    projectId: project.id,
  });
  await openViewPage(page, view);
  const main = await viewRoot(page);
  await expect(
    main.getByRole("button", { name: "List", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    main.getByRole("button", { name: "To Do 3", exact: true }),
  ).toBeVisible();

  await main.getByRole("button", { name: "Board", exact: true }).click();
  await expect(
    main.getByRole("button", { name: "Board", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(taskCard(main, urgent.title).first()).toBeVisible();
  await expect(
    main.getByRole("button", { name: "To Do 3", exact: true }),
  ).toHaveCount(0);

  await main.getByRole("button", { name: "Spreadsheet", exact: true }).click();
  await expect(main.getByRole("table")).toBeVisible();
  await expect(
    main.getByRole("row", { name: new RegExp(escapeRegExp(urgent.title)) }),
  ).toBeVisible();
  // A layout change is an unsaved change of the view.
  await expect(main.getByText("Unsaved changes")).toBeVisible();
});

test.describe("workspace views and your work", () => {
  test("built-in workspace views list the owner's assigned and created tasks", async ({
    page,
    api,
    seed,
  }) => {
    const mine = await createTask(api, project.id, {
      title: uniqueName("Assigned to owner"),
      assigneeIds: [seed.users.owner.id],
    });
    const theirs = await createTask(api, project.id, {
      title: uniqueName("Assigned to admin"),
      assigneeIds: [seed.users.admin.id],
    });

    await page.goto(`/dashboard/workspace/${seed.workspace.id}/views`);
    const tabs = page.getByRole("navigation", { name: "Views" });
    await expect(tabs.getByRole("tab", { name: "All tasks" })).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 60_000 },
    );
    const rowOf = (task: TestTask) =>
      page.getByRole("row", { name: new RegExp(escapeRegExp(task.title)) });
    // Newest first, so this spec's tasks lead the list.
    await expect(rowOf(mine)).toBeVisible();
    await expect(rowOf(theirs)).toBeVisible();

    await tabs.getByRole("tab", { name: "Assigned to me" }).click();
    await expect(rowOf(mine)).toBeVisible();
    await expect(rowOf(theirs)).toHaveCount(0);

    await tabs.getByRole("tab", { name: "Created by me" }).click();
    await expect(rowOf(mine)).toBeVisible();
    await expect(rowOf(theirs)).toBeVisible();

    // The layout toggle.
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(taskCard(page, mine.title).first()).toBeVisible();
  });

  test("Your work summarises the owner's tasks and lists them by tab", async ({
    page,
    api,
    seed,
  }) => {
    const assigned = await createTask(api, project.id, {
      title: uniqueName("My open work"),
      priority: "high",
      assigneeIds: [seed.users.owner.id],
    });
    await page.goto(`/dashboard/workspace/${seed.workspace.id}/my-work`);
    const tabs = page.getByRole("tablist");
    await expect(tabs.getByRole("tab", { name: "Summary" })).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 60_000 },
    );
    await expect(
      page.getByRole("button", { name: /^Assigned and open \d+$/ }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "By state" })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: new RegExp(`^${escapeRegExp(project.name)} 1 0$`),
      }),
    ).toBeVisible();

    await tabs.getByRole("tab", { name: "Assigned" }).click();
    await expect(
      page
        .getByRole("button", { name: new RegExp(escapeRegExp(assigned.title)) })
        .first(),
    ).toBeVisible();
    await tabs.getByRole("tab", { name: "Created" }).click();
    await expect(
      page
        .getByRole("button", { name: new RegExp(escapeRegExp(urgent.title)) })
        .first(),
    ).toBeVisible();
  });
});
