import { expect, test } from "../../../fixtures";
import { readJson } from "../../../helpers/http";
import {
  addLabelToTask,
  boardPath,
  createProject,
  createTask,
  deleteProject,
  getTask,
  isoDayOffset,
  listBoard,
  projectViewPath,
  setProjectFeatures,
  type TestProject,
  type TestTask,
  taskLabelNames,
  taskPagePath,
} from "../../../helpers/task-data";
import {
  boardColumn,
  escapeRegExp,
  localYmd,
  openTaskPage,
  taskCard,
  toast,
  waitForBoardReady,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

type ActivityEntry = {
  id: string;
  type: string;
  content: string | null;
  userId: string | null;
};

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Task actions") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

function key(task: TestTask) {
  return `${project.slug}-${task.number}`;
}

test("making a copy honours the chosen options", async ({
  page,
  api,
  seed,
}) => {
  const source = await createTask(api, project.id, {
    title: uniqueName("Copy source"),
    description: "Steps to reproduce the problem.",
    priority: "high",
    status: "in-progress",
    assigneeIds: [seed.users.member.id],
    dueDate: isoDayOffset(6),
  });
  await addLabelToTask(api, seed.labels.bug.id, source.id);

  await openTaskPage(page, taskPagePath(project.id, source.id));
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Make a copy…" }).click();

  const dialog = page.getByRole("dialog", {
    name: `Make a copy of ${key(source)}`,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title")).toHaveValue(
    `${source.title} (copy)`,
  );
  const copyTitle = uniqueName("Copied task");
  await dialog.getByLabel("Title").fill(copyTitle);

  // Options with something to copy are listed and checked by default.
  for (const option of [
    "Description",
    "Assignees",
    "Labels",
    "Start and due dates",
  ]) {
    await expect(dialog.getByRole("checkbox", { name: option })).toBeChecked();
  }
  await dialog.getByRole("checkbox", { name: "Labels" }).click();
  await expect(
    dialog.getByRole("checkbox", { name: "Labels" }),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: "Make a copy" }).click();

  await expect(toast(page, /^Copy created: /)).toBeVisible();
  await expect(dialog).toBeHidden();

  const copy = (await listBoard(api, project.id)).columns
    .flatMap((column) => column.tasks)
    .find((task) => task.title === copyTitle);
  if (!copy) throw new Error("the copy was not created");
  const saved = await getTask(api, copy.id);
  expect(saved.status).toBe("in-progress");
  expect(saved.priority).toBe("high");
  expect(saved.description).toContain("Steps to reproduce the problem.");
  expect(saved.assigneeIds).toEqual([seed.users.member.id]);
  expect(localYmd(saved.dueDate)).toBe(localYmd(source.dueDate));
  expect(await taskLabelNames(api, copy.id)).toEqual([]);
  expect(await taskLabelNames(api, source.id)).toEqual(["Bug"]);

  // Both tasks record the copy.
  await expect(
    page.getByText(
      new RegExp(
        `made a copy of this task: ${escapeRegExp(key(copy as TestTask))}`,
      ),
    ),
  ).toBeVisible();
  await openTaskPage(page, taskPagePath(project.id, copy.id));
  await expect(
    page.getByText(
      new RegExp(`created this task as a copy of ${escapeRegExp(key(source))}`),
    ),
  ).toBeVisible();

  await page.goto(boardPath(project.id));
  await expect(
    taskCard(boardColumn(page, "In Progress"), copyTitle),
  ).toBeVisible();
});

test("the task key and link copy to the clipboard", async ({
  page,
  context,
  api,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const task = await createTask(api, project.id, {
    title: uniqueName("Key copy"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Copy task key" }).click();
  await expect(toast(page, `Copied ${key(task)}`)).toBeVisible();
  await expect.poll(clipboard).toBe(key(task));

  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Copy link" }).click();
  // "Copy link" shares the readable key link (…/task/KEY-12).
  await expect
    .poll(clipboard)
    .toMatch(new RegExp(`/dashboard/workspace/[^/]+/task/${key(task)}$`));

  // The key above the title copies itself too.
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .getByRole("main")
    .getByRole("button", { name: key(task), exact: true })
    .last()
    .click();
  await expect.poll(clipboard).toBe(key(task));
});

test("deleting a task from its page and from a card", async ({ page, api }) => {
  const fromPage = await createTask(api, project.id, {
    title: uniqueName("Delete from page"),
  });
  const fromCard = await createTask(api, project.id, {
    title: uniqueName("Delete from card"),
  });

  await openTaskPage(page, taskPagePath(project.id, fromPage.id));
  await page.getByRole("button", { name: "Delete task" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete task?" });
  await expect(confirm).toContainText(
    "The task and its sub-tasks move to the project's trash. You can restore them from Recently deleted in project settings.",
  );
  await confirm.getByRole("button", { name: "Delete task" }).click();
  await expect(toast(page, "Task moved to the trash")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/project/${project.id}/board`));
  // The API documents 400 "Unknown task" for ids that no longer exist.
  expect([400, 404]).toContain(
    (await api.get(`/api/task/${fromPage.id}`)).status(),
  );

  await waitForBoardReady(page);
  await expect(taskCard(page, fromPage.title)).toHaveCount(0);
  await taskCard(page, fromCard.title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete..." }).click();
  await page
    .getByRole("alertdialog", { name: "Delete task?" })
    .getByRole("button", { name: "Delete task" })
    .click();
  await expect(taskCard(page, fromCard.title)).toHaveCount(0);
  await expect
    .poll(async () => (await api.get(`/api/task/${fromCard.id}`)).ok())
    .toBe(false);
});

test("archiving hides a task from the board and restoring brings it back", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Archive me"),
  });
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);

  await taskCard(page, task.title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(taskCard(page, task.title)).toHaveCount(0);
  await expect
    .poll(async () => Boolean((await getTask(api, task.id)).archivedAt))
    .toBe(true);

  // The backlog lists it under Archived.
  await page.goto(projectViewPath(project.id, "backlog"));
  const archived = page.getByRole("button", { name: /^Archived 1/ });
  await expect(archived).toBeVisible();
  const row = taskCard(page, task.title);
  await expect(row).toBeVisible();

  // Restore it to the board from the backlog selection bar.
  await row.click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("button", { name: "Move to board" }).click();
  await page.getByRole("menuitem", { name: "To Do" }).click();
  await expect(toast(page, "1 tasks moved to board")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Archived 0/ })).toBeVisible();
  await expect
    .poll(async () => (await getTask(api, task.id)).archivedAt ?? null)
    .toBeNull();

  await page.goto(boardPath(project.id));
  await expect(taskCard(boardColumn(page, "To Do"), task.title)).toBeVisible();
});

test("comments are added with a mention, edited and deleted", async ({
  page,
  api,
  seed,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Commented task"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));

  const composer = page
    .getByRole("region", { name: "Comment editor" })
    .last()
    .locator("[contenteditable='true']");
  await composer.click();
  await page.keyboard.type("Looks good, ");
  await page.keyboard.type("@Mia");
  const suggestion = page.getByRole("button", { name: "Mia Member" });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await page.keyboard.type(" please review");
  await expect(composer).toContainText("please review");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(toast(page, "Comment added")).toBeVisible();

  const listComments = async () =>
    (
      await readJson<ActivityEntry[]>(
        await api.get(`/api/activity/${task.id}`),
        "list activity",
      )
    ).filter((entry) => entry.type === "comment");
  await expect.poll(async () => (await listComments()).length).toBe(1);
  const [comment] = await listComments();
  if (!comment) throw new Error("the comment was not saved");
  expect(comment.content).toContain("Looks good,");
  expect(comment.content).toContain(`id="${seed.users.member.id}"`);

  const card = page
    .locator("div.group")
    .filter({ hasText: "please review" })
    .filter({ has: page.getByText("Olivia Owner") })
    .last();
  await expect(card).toBeVisible();
  await expect(card.getByText(/Mia Member/)).toBeVisible();

  // Edit: the hover toolbar's buttons have no accessible names (tooltips only).
  await card.hover();
  // Hover actions: "Add reaction", then edit and delete (tooltip-only names).
  const hoverActions = card.locator("div.absolute").getByRole("button");
  await hoverActions.nth(-2).click();
  const editor = card.locator("[contenteditable='true']");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" (edited)");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Comment updated")).toBeVisible();
  await expect
    .poll(async () => (await listComments())[0]?.content ?? "")
    .toContain("(edited)");
  await expect(card).toContainText("(edited)");

  // Delete
  await card.hover();
  await card.locator("div.absolute").getByRole("button").last().click();
  await expect(page.getByText("please review")).toHaveCount(0);
  await expect.poll(async () => (await listComments()).length).toBe(0);
});

test("time can be logged on a task while time tracking is on", async ({
  page,
  api,
}) => {
  await setProjectFeatures(api, project.id, { timeTrackingEnabled: true });
  const task = await createTask(api, project.id, {
    title: uniqueName("Timed task"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));
  const logTime = page.getByRole("button", { name: "Log time" }).first();
  await expect(logTime).toBeVisible({ timeout: 5_000 });

  await logTime.click();
  await page.getByLabel("Duration").fill("1h 30m");
  await page.getByLabel("Note (optional)").fill("Code review");
  await page.getByRole("button", { name: "Log time" }).last().click();
  await expect(page.getByText("Time logged")).toBeVisible();
  const entries = page.getByRole("list", { name: "Time entries" });
  await expect(entries.getByText("1h 30m")).toBeVisible();
  await expect(entries.getByText(/Code review/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Time spent: 1h 30m. Log time" }).first(),
  ).toBeVisible();
});
