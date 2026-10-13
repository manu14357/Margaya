import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { readJson } from "../../../helpers/http";
import {
  addTasksToModule,
  boardPath,
  createCycle,
  createModule,
  createProject,
  createTask,
  dayOffset,
  deleteProject,
  listBoard,
  projectViewPath,
  type TestProject,
  taskModuleNames,
  taskPagePath,
} from "../../../helpers/task-data";
import {
  closeMenus,
  dismissPopover,
  localDay,
  openPopover,
  openTaskPage,
  pickCalendarDay,
  taskCard,
  toast,
  waitForBoardReady,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

type Module = {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  leadId?: string | null;
  lead?: { id: string } | null;
  memberIds?: string[];
  members?: { id: string }[];
  archivedAt: string | null;
};

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, {
    name: uniqueName("Modules"),
    features: { modulesEnabled: true, cyclesEnabled: true },
  });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

async function listModules(
  api: APIRequestContext,
  view: "active" | "archived" = "active",
) {
  return readJson<Module[]>(
    await api.get(`/api/module/project/${project.id}`, { params: { view } }),
    "list modules",
  );
}

function modulePath(moduleId: string) {
  return `${projectViewPath(project.id, "modules")}/${moduleId}`;
}

/** Opens a module page; ready once its actions and details panel render. */
async function openModulePage(page: Page, moduleId: string) {
  await page.goto(modulePath(moduleId));
  await expect(
    page.getByRole("button", { name: "Module actions" }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("complementary", { name: "Module details" }),
  ).toBeVisible();
}

test("a module is created with status, lead, members and dates", async ({
  page,
  api,
  seed,
}) => {
  await page.goto(projectViewPath(project.id, "modules"));
  await expect(page.getByText("No modules yet")).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "New module" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New module" });
  await dialog.getByLabel("Name").fill("Checkout flow");
  await dialog
    .getByLabel("Description")
    .fill("Everything between cart and receipt.");

  await dialog.getByRole("button", { name: "Status" }).click();
  await openPopover(page)
    .getByRole("button", { name: /^In progress/ })
    .click();
  await expect(dialog.getByRole("button", { name: "Status" })).toContainText(
    "In progress",
  );

  await dialog.getByRole("button", { name: "Lead" }).click();
  await openPopover(page)
    .getByRole("button", { name: /Adam Admin/ })
    .click();
  await expect(dialog.getByRole("button", { name: "Lead" })).toContainText(
    "Adam Admin",
  );

  await dialog.getByRole("button", { name: "Members" }).click();
  const people = openPopover(page);
  await people.getByRole("button", { name: /Adam Admin/ }).click();
  await people.getByRole("button", { name: /Mia Member/ }).click();
  await expect(
    people.getByRole("button", { name: /Mia Member/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await dismissPopover(
    page,
    dialog.getByText("Group the tasks for one feature"),
  );

  await dialog.getByRole("button", { name: "Start date" }).click();
  await pickCalendarDay(openPopover(page), localDay(0));
  await dismissPopover(
    page,
    dialog.getByText("Group the tasks for one feature"),
  );
  await dialog.getByRole("button", { name: "Target date" }).click();
  await pickCalendarDay(openPopover(page), localDay(10));
  await dismissPopover(
    page,
    dialog.getByText("Group the tasks for one feature"),
  );

  await dialog.getByRole("button", { name: "Create module" }).click();
  await expect(toast(page, "Module created")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: "Checkout flow" })).toBeVisible();

  const [created] = await listModules(api);
  expect(created).toMatchObject({
    name: "Checkout flow",
    status: "in-progress",
    startDate: dayOffset(0),
    targetDate: dayOffset(10),
  });
  if (!created) throw new Error("the module was not created");
  const leadId = created.leadId ?? created.lead?.id;
  expect(leadId).toBe(seed.users.admin.id);
  const memberIds =
    created.memberIds ?? created.members?.map((m) => m.id) ?? [];
  expect([...memberIds].sort()).toEqual(
    [seed.users.admin.id, seed.users.member.id].sort(),
  );

  // A duplicate name is refused.
  await page.getByRole("button", { name: "New module" }).first().click();
  const again = page.getByRole("dialog", { name: "New module" });
  await again.getByLabel("Name").fill("Checkout flow");
  await again.getByRole("button", { name: "Create module" }).click();
  await expect(
    again.getByText("A module with this name already exists"),
  ).toBeVisible();
});

test("a task belongs to several modules and the module page tracks progress", async ({
  page,
  api,
}) => {
  const payments = await createModule(api, project.id, {
    name: "Payments",
    status: "in-progress",
    startDate: dayOffset(-2),
    targetDate: dayOffset(12),
  });
  const receipts = await createModule(api, project.id, {
    name: "Receipts",
    status: "planned",
  });
  const shared = await createTask(api, project.id, {
    title: uniqueName("Shared work"),
  });
  const other = await createTask(api, project.id, {
    title: uniqueName("Other work"),
  });

  await openTaskPage(page, taskPagePath(project.id, shared.id));
  await expect(
    page.getByText("No modules", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add to module" }).click();
  const picker = openPopover(page);
  await picker.getByRole("button", { name: "Payments" }).click();
  await picker.getByRole("button", { name: "Receipts" }).click();
  await expect(
    picker.getByRole("button", { name: "Receipts" }),
  ).toHaveAttribute("aria-pressed", "true");
  await dismissPopover(page, page.getByRole("heading", { name: "Activity" }));
  await expect
    .poll(async () => (await taskModuleNames(api, shared.id)).sort())
    .toEqual(["Payments", "Receipts"]);
  // The sidebar lists both as links to the module pages.
  await expect(page.getByRole("link", { name: "Payments" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Receipts" })).toBeVisible();
  await expect(
    page.getByText("added the task to module Payments"),
  ).toBeVisible();
  await expect(
    page.getByText("added the task to module Receipts"),
  ).toBeVisible();

  // The Payments page: add the second task with "Add existing".
  await openModulePage(page, payments.id);
  await expect(taskCard(page, shared.title)).toBeVisible();
  await page.getByRole("button", { name: "Add existing" }).click();
  const dialog = page.getByRole("dialog", { name: "Add existing tasks" });
  await dialog
    .getByPlaceholder("Search tasks by key or title")
    .fill(other.title);
  await dialog.getByRole("button", { name: new RegExp(other.title) }).click();
  await dialog.getByRole("button", { name: "Add 1 task" }).click();
  await expect(toast(page, "Added 1 task to Payments")).toBeVisible();
  await expect(taskCard(page, other.title)).toBeVisible();

  const details = page.getByRole("complementary", { name: "Module details" });
  await expect(
    details.getByRole("heading", { name: "Payments" }),
  ).toBeVisible();
  await expect(details.getByText("2 tasks")).toBeVisible();
  await expect(details.getByText("0%", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("img", { name: /^2 of 2 tasks left/ }),
  ).toBeVisible();

  // Finishing one task moves the progress.
  await api.put(`/api/task/status/${other.id}`, { data: { status: "done" } });
  await page.reload();
  await expect(details.getByText("50%", { exact: true })).toBeVisible();
  await expect(
    details.getByRole("img", { name: /^1 of 2 tasks left/ }),
  ).toBeVisible();

  // Receipts only holds the shared task.
  await openModulePage(page, receipts.id);
  await expect(taskCard(page, shared.title)).toBeVisible();
  await expect(taskCard(page, other.title)).toHaveCount(0);

  // The board card shows both module chips.
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);
  await expect(taskCard(page, shared.title)).toContainText("Payments");
});

test("module links are added, edited and deleted", async ({ page, api }) => {
  const mod = await createModule(api, project.id, {
    name: "Docs site",
    status: "planned",
  });
  await openModulePage(page, mod.id);
  const details = page.getByRole("complementary", { name: "Module details" });
  await expect(details.getByText("No links yet")).toBeVisible();

  await details.getByRole("button", { name: "Add link" }).click();
  let dialog = page.getByRole("dialog", { name: "Add link" });
  await dialog.getByLabel("URL").fill("not a url");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(
    dialog.getByText("Enter a valid http or https URL"),
  ).toBeVisible();
  await dialog.getByLabel("URL").fill("https://example.com/design");
  await dialog.getByLabel("Title").fill("Design file");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Link saved")).toBeVisible();
  const link = details.getByRole("link", { name: "Open Design file" });
  await expect(link).toHaveAttribute("href", "https://example.com/design");

  await link.hover();
  await details.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit link" });
  await dialog.getByLabel("Title").fill("Design file v2");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(
    details.getByRole("link", { name: "Open Design file v2" }),
  ).toBeVisible();

  const links = await readJson<{ url: string; title: string | null }[]>(
    await api.get(`/api/module/${mod.id}/links`),
    "list module links",
  );
  expect(links).toEqual([
    expect.objectContaining({
      url: "https://example.com/design",
      title: "Design file v2",
    }),
  ]);

  await details.getByRole("link", { name: "Open Design file v2" }).hover();
  await details.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Delete this link?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(toast(page, "Link deleted")).toBeVisible();
  await expect(details.getByText("No links yet")).toBeVisible();
});

test("the modules list switches between list and gallery layouts", async ({
  page,
  api,
}) => {
  await createModule(api, project.id, {
    name: "Search",
    status: "in-progress",
  });
  await createModule(api, project.id, { name: "Billing", status: "backlog" });

  await page.goto(projectViewPath(project.id, "modules"));
  await expect(page.getByRole("link", { name: "Search" })).toBeVisible({
    timeout: 30_000,
  });
  // Gallery cards spell out "0/0 done"; list rows show a compact "0/0".
  const cardCounts = page.getByText("0/0 done", { exact: true });
  await expect(cardCounts).toHaveCount(0);

  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("menuitemradio", { name: "Gallery" }).click();
  await page.keyboard.press("Escape");
  await expect(cardCounts).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();

  // The layout is remembered.
  await page.reload();
  await expect(page.getByRole("link", { name: "Search" })).toBeVisible();
  await expect(cardCounts).toHaveCount(2);

  await page.getByRole("button", { name: "Display" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "Gallery" }),
  ).toBeChecked();
  await page.getByRole("menuitemradio", { name: "List" }).click();
  await page.keyboard.press("Escape");
  await expect(cardCounts).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();
});

test("a completed module is archived and restored", async ({ page, api }) => {
  await createModule(api, project.id, {
    name: "Still going",
    status: "in-progress",
  });
  await createModule(api, project.id, {
    name: "Wrapped up",
    status: "completed",
  });

  await page.goto(projectViewPath(project.id, "modules"));
  const finishedLink = page.getByRole("link", { name: "Wrapped up" });
  await expect(finishedLink).toBeVisible({ timeout: 30_000 });

  // Only completed or cancelled modules can be archived.
  const rowActions = (name: string) =>
    page
      .getByRole("link", { name })
      .locator(
        "xpath=ancestor::div[.//button[@aria-label='Module actions']][1]",
      )
      .getByRole("button", { name: "Module actions" });
  await rowActions("Still going").click();
  // The disabled item carries its hint in its name.
  await expect(
    page.getByRole("menuitem", {
      name: /^Archive Only completed or cancelled modules can be archived/,
    }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  await rowActions("Wrapped up").click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Archive module?" });
  await confirm.getByRole("button", { name: "Archive" }).click();
  await expect(toast(page, "Module archived")).toBeVisible();
  await expect(finishedLink).toHaveCount(0);
  expect((await listModules(api, "archived")).map((m) => m.name)).toEqual([
    "Wrapped up",
  ]);

  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect(page.getByRole("link", { name: "Wrapped up" })).toBeVisible();
  await page.getByRole("button", { name: "Module actions" }).first().click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await expect(toast(page, "Module restored")).toBeVisible();
  await page.getByRole("button", { name: "Active", exact: true }).click();
  await expect(page.getByRole("link", { name: "Wrapped up" })).toBeVisible();
  expect(await listModules(api, "archived")).toEqual([]);
});

test("the card menu's Cycle and Modules submenus assign a task", async ({
  page,
  api,
}) => {
  const cycle = await createCycle(api, project.id, {
    name: "Sprint Menu",
    startDate: dayOffset(-1),
    endDate: dayOffset(9),
  });
  await createModule(api, project.id, {
    name: "Onboarding",
    status: "planned",
  });
  await createModule(api, project.id, {
    name: "Growth",
    status: "in-progress",
  });
  const task = await createTask(api, project.id, {
    title: uniqueName("Menu task"),
  });

  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);

  await taskCard(page, task.title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Cycle", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Sprint Menu" }).click();
  await expect(taskCard(page, task.title)).toContainText("Sprint Menu");

  await taskCard(page, task.title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Modules", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Onboarding" }).click();
  // The submenu stays open so several modules can be toggled.
  await page.getByRole("menuitemcheckbox", { name: "Growth" }).click();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Growth" }),
  ).toBeChecked();
  await closeMenus(page);

  await expect
    .poll(async () => (await taskModuleNames(api, task.id)).sort())
    .toEqual(["Growth", "Onboarding"]);
  const onBoard = (await listBoard(api, project.id)).columns
    .flatMap((column) => column.tasks)
    .find((candidate) => candidate.id === task.id);
  expect(onBoard?.cycleId).toBe(cycle.id);

  // Unchecking removes the task from one module.
  await taskCard(page, task.title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Modules", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Onboarding" }).click();
  await closeMenus(page);
  await expect
    .poll(async () => taskModuleNames(api, task.id))
    .toEqual(["Growth"]);

  void addTasksToModule;
});
