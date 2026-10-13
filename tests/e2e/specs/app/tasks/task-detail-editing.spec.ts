import { expect, test } from "../../../fixtures";
import {
  addLabelToTask,
  boardPath,
  createProject,
  createTask,
  deleteProject,
  getTask,
  type TestProject,
  taskLabelNames,
  taskPagePath,
} from "../../../helpers/task-data";
import {
  boardColumn,
  dismissPopover,
  localDay,
  localYmd,
  openPopover,
  openTaskPage,
  pickCalendarDay,
  shortDate,
  taskCard,
  taskSheet,
  toast,
  waitForBoardReady,
  ymd,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Task editing") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

test("the title and a formatted description save from the task page", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Rename me"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));

  const newTitle = uniqueName("Renamed task");
  const title = page.getByRole("textbox", { name: "Click to add a title" });
  await expect(title).toHaveValue(task.title);
  await title.fill(newTitle);
  await expect
    .poll(async () => (await getTask(api, task.id)).title)
    .toBe(newTitle);

  const editor = page
    .getByRole("region", { name: "Task description editor" })
    .locator("[contenteditable='true']");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("Bold statement");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("Enter");

  // Slash command: a bulleted list.
  await page.keyboard.type("/bullet");
  const slashItem = page.getByRole("button", { name: "Bulleted list" });
  await expect(slashItem).toBeVisible();
  await slashItem.dispatchEvent("mousedown");
  await page.keyboard.type("First point");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  // Slash command: a code block.
  await page.keyboard.type("/code");
  const codeItem = page.getByRole("button", { name: "Code block" });
  await expect(codeItem).toBeVisible();
  await codeItem.dispatchEvent("mousedown");
  await page.keyboard.type("const answer = 42;");

  await expect(editor.locator("strong")).toHaveText("Bold statement");
  await expect(editor.locator("ul li")).toHaveText("First point");
  await expect(editor.locator("pre")).toContainText("const answer = 42;");

  await expect
    .poll(async () => (await getTask(api, task.id)).description ?? "", {
      timeout: 15_000,
    })
    .toContain("const answer = 42;");
  const markdown = (await getTask(api, task.id)).description ?? "";
  expect(markdown).toContain("**Bold statement**");
  expect(markdown).toMatch(/^[-*] First point$/m);
  expect(markdown).toContain("```");

  // The formatting survives a reload.
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Click to add a title" }),
  ).toHaveValue(newTitle);
  const reloaded = page
    .getByRole("region", { name: "Task description editor" })
    .locator("[contenteditable]");
  await expect(reloaded.locator("strong")).toHaveText("Bold statement");
  await expect(reloaded.locator("ul li")).toHaveText("First point");
  await expect(reloaded.locator("pre")).toContainText("const answer = 42;");

  // The activity records the rename.
  await expect(
    page.getByText(`changed title from "${task.title}" to "${newTitle}"`),
  ).toBeVisible();
});

test("an @mention in the description links another member", async ({
  page,
  api,
  seed,
}) => {
  // Regression test for app-tasks.md #1 (fixed).
  const task = await createTask(api, project.id, {
    title: uniqueName("Mention in description"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));

  const editor = page
    .getByRole("region", { name: "Task description editor" })
    .locator("[contenteditable='true']");
  await editor.click();
  await page.keyboard.type("Ping @Mia");
  const suggestion = page.getByRole("button", { name: "Mia Member" });
  await expect(suggestion).toBeVisible({ timeout: 5_000 });
  await suggestion.click();

  await expect
    .poll(async () => (await getTask(api, task.id)).description ?? "")
    .toContain(`id="${seed.users.member.id}"`);
});

test("sidebar properties change from the task sheet and show on the card", async ({
  page,
  api,
  seed,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Sheet properties"),
  });
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);

  await taskCard(page, task.title).click();
  await expect(page).toHaveURL(new RegExp(`taskId=${task.id}`));
  const sheet = taskSheet(page);
  await expect(
    sheet.getByRole("button", { name: "Add subtask" }),
  ).toBeVisible();

  // Status
  await sheet.getByRole("button", { name: "To Do", exact: true }).click();
  await openPopover(page)
    .getByRole("button", { name: /^In Progress/ })
    .click();
  await expect(
    sheet.getByRole("button", { name: "In Progress", exact: true }),
  ).toBeVisible();

  // Priority
  await sheet.getByRole("button", { name: "No priority", exact: true }).click();
  await openPopover(page)
    .getByRole("button", { name: /^Urgent/ })
    .click();
  await expect(
    sheet.getByRole("button", { name: "Urgent", exact: true }),
  ).toBeVisible();

  // Several assignees
  await sheet.getByRole("button", { name: /Unassigned/ }).click();
  const people = openPopover(page);
  for (const name of ["Mia Member", "Adam Admin", "Victor Viewer"]) {
    const row = people.getByRole("menuitemcheckbox", {
      name: new RegExp(name),
    });
    await row.click();
    await expect(row).toHaveAttribute("aria-checked", "true");
  }
  await dismissPopover(page, sheet.getByRole("heading", { name: "Activity" }));
  await expect(
    sheet.getByRole("button", {
      name: /Assigned to Mia Member, Adam Admin, Victor Viewer/,
    }),
  ).toContainText("Mia Member +2");

  // Start and due dates: one row each in the property grid.
  const start = localDay(0);
  const due = localDay(4);
  const startRow = sheet.locator("[data-property='startDate']");
  const dueRow = sheet.locator("[data-property='dueDate']");
  await expect(startRow).toContainText("Start date");
  await startRow.getByRole("button", { name: "No date", exact: true }).click();
  await pickCalendarDay(openPopover(page), start);
  await expect(
    toast(page, "Task start date updated successfully"),
  ).toBeVisible();
  await dismissPopover(page, sheet.getByRole("heading", { name: "Activity" }));
  await expect(
    startRow.getByRole("button", { name: shortDate(start), exact: true }),
  ).toBeVisible();

  await dueRow.getByRole("button", { name: "No date", exact: true }).click();
  await pickCalendarDay(openPopover(page), due);
  await expect(toast(page, "Task due date updated successfully")).toBeVisible();
  await dismissPopover(page, sheet.getByRole("heading", { name: "Activity" }));
  await expect(
    dueRow.getByRole("button", { name: shortDate(due), exact: true }),
  ).toBeVisible();

  // Labels
  const labelsSection = sheet.locator("[data-property='labels']");
  await labelsSection.getByRole("button", { name: "Add label" }).click();
  await openPopover(page).getByRole("button", { name: "Bug" }).click();
  await expect(toast(page, "Label added").first()).toBeVisible();
  await expect(labelsSection.getByText("Bug", { exact: true })).toBeVisible();
  await openPopover(page)
    .getByRole("button", { name: "Documentation" })
    .click();
  await expect(
    labelsSection.getByText("Documentation", { exact: true }),
  ).toBeVisible();
  await dismissPopover(page, sheet.getByRole("heading", { name: "Activity" }));

  await expect
    .poll(async () => {
      const saved = await getTask(api, task.id);
      return {
        status: saved.status,
        priority: saved.priority,
        assignees: saved.assigneeIds,
        start: localYmd(saved.startDate),
        due: localYmd(saved.dueDate),
      };
    })
    .toEqual({
      status: "in-progress",
      priority: "urgent",
      assignees: [
        seed.users.member.id,
        seed.users.admin.id,
        seed.users.viewer.id,
      ],
      start: ymd(start),
      due: ymd(due),
    });
  expect((await taskLabelNames(api, task.id)).sort()).toEqual([
    "Bug",
    "Documentation",
  ]);

  // Close the sheet: the card moved columns and shows the avatar stack.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  const card = taskCard(boardColumn(page, "In Progress"), task.title);
  await expect(card).toHaveAccessibleName(
    /Assigned to Mia Member, Adam Admin, Victor Viewer/,
  );
  await expect(
    card.getByRole("img", { name: /Assigned to Mia Member/ }),
  ).toContainText("+1");
  await expect(card).toContainText(shortDate(due));
  await expect(card).toContainText("Bug");

  // The activity timeline lists the changes.
  await taskCard(page, task.title).click();
  const reopened = taskSheet(page);
  for (const entry of [
    "changed status from To Do to In Progress",
    "changed priority from No priority to Urgent",
    "assigned the task to Mia Member",
    "assigned the task to Victor Viewer",
    /set due date to/,
    /set the start date to/,
  ]) {
    await expect(reopened.getByText(entry).first()).toBeVisible();
  }
});

test("the activity timeline lists changes made elsewhere", async ({
  page,
  api,
  seed,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Timeline"),
  });
  await api.put(`/api/task/status/${task.id}`, {
    data: { status: "in-review" },
  });
  await api.put(`/api/task/priority/${task.id}`, {
    data: { priority: "high" },
  });
  await api.patch(`/api/task/assignees/${task.id}`, {
    data: { add: [seed.users.admin.id] },
  });
  await addLabelToTask(api, seed.labels.feature.id, task.id);
  await api.post(`/api/task-link/${task.id}`, {
    data: { url: "https://example.com/timeline", title: "Timeline doc" },
  });

  await openTaskPage(page, taskPagePath(project.id, task.id));
  const entries = [
    "created this task",
    "changed status from To Do to In Review",
    "changed priority from No priority to High",
    "assigned the task to Adam Admin",
    "added the label Feature",
    "added the link Timeline doc",
  ];
  for (const entry of entries) {
    await expect(page.getByText(entry).first()).toBeVisible();
  }
});

test("Escape after picking an assignee closes only the picker", async ({
  page,
  api,
}) => {
  // Regression test for app-tasks.md #2 (fixed).
  const task = await createTask(api, project.id, {
    title: uniqueName("Escape picker"),
  });
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);
  await taskCard(page, task.title).click();
  const sheet = taskSheet(page);
  await expect(
    sheet.getByRole("button", { name: "Add subtask" }),
  ).toBeVisible();

  await sheet.getByRole("button", { name: /Unassigned/ }).click();
  const row = openPopover(page).getByRole("menuitemcheckbox", {
    name: /Mia Member/,
  });
  await row.click();
  await page.keyboard.press("Escape");

  await expect(
    page.locator("[data-slot='popover-popup'][data-open]"),
  ).toHaveCount(0);
  // The sheet must stay open: fail if it closes within its exit animation.
  const closed = await sheet
    .waitFor({ state: "hidden", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  expect(closed, "Escape closed the task sheet too").toBe(false);
  await expect(page).toHaveURL(new RegExp(`taskId=${task.id}`));
});
