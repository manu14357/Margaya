import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { readJson } from "../../../helpers/http";
import {
  boardPath,
  createProject,
  createTask,
  deleteProject,
  getTask,
  listBoard,
  type TestProject,
  type TestTask,
  taskPagePath,
} from "../../../helpers/task-data";
import {
  escapeRegExp,
  openPopover,
  openTaskPage,
  taskCard,
  taskSheet,
  toast,
  waitForBoardReady,
} from "../../../helpers/task-ui";
import { uniqueName } from "../../../helpers/ui";

// The dev servers are shared with other suites; allow slow page loads.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 120_000 });

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "attachment-note.txt",
);

type Relation = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
};

let project: TestProject;

test.beforeEach(async ({ api }) => {
  project = await createProject(api, { name: uniqueName("Task structure") });
});

test.afterEach(async ({ api }) => {
  if (project) await deleteProject(api, project.id);
});

function key(task: TestTask) {
  return `${project.slug}-${task.number}`;
}

async function listRelations(api: APIRequestContext, taskId: string) {
  return readJson<Relation[]>(
    await api.get(`/api/task-relation/${taskId}`),
    "list relations",
  );
}

test("sub-tasks are created inline and completed with their checkbox", async ({
  page,
  api,
}) => {
  const parent = await createTask(api, project.id, {
    title: uniqueName("Parent work"),
  });
  await openTaskPage(page, taskPagePath(project.id, parent.id));

  const first = uniqueName("Sub one");
  const second = uniqueName("Sub two");
  await page.getByRole("button", { name: "Add subtask" }).click();
  const input = page.getByPlaceholder("Subtask title...");
  await input.fill(first);
  await input.press("Enter");
  await expect(page.getByRole("button", { name: first })).toBeVisible();
  await page.getByRole("button", { name: "Add subtask" }).click();
  await input.fill(second);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: second })).toBeVisible();

  const checkboxes = page.getByRole("checkbox", {
    name: "Mark subtask complete",
  });
  await expect(checkboxes).toHaveCount(2);
  await checkboxes.first().click();
  await expect(checkboxes.first()).toBeChecked();
  await expect(checkboxes.nth(1)).not.toBeChecked();

  const board = await listBoard(api, project.id);
  const subtasks = board.columns
    .flatMap((column) => column.tasks)
    .filter((task) => task.title === first || task.title === second);
  expect(subtasks).toHaveLength(2);
  await expect
    .poll(async () => {
      const tasks = (await listBoard(api, project.id)).columns.flatMap(
        (column) => column.tasks,
      );
      return tasks.find((task) => task.title === first)?.status;
    })
    .toBe("done");

  const relations = await listRelations(api, parent.id);
  expect(
    relations.filter((relation) => relation.relationType === "subtask"),
  ).toHaveLength(2);

  // The completed sub-task shows as done after a reload too.
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Mark subtask complete" }).first(),
  ).toBeChecked();
  await expect(page.getByText("added the sub-task").first()).toBeVisible();
});

test("every relation type can be added and a relation removed", async ({
  page,
  api,
}) => {
  const main = await createTask(api, project.id, {
    title: uniqueName("Main task"),
  });
  const kinds = [
    { label: "Blocking", stored: "blocks", flipped: false },
    { label: "Blocked by", stored: "blocks", flipped: true },
    { label: "Relates to", stored: "related", flipped: false },
    { label: "Duplicate of", stored: "duplicate", flipped: false },
    { label: "Starts before", stored: "start_before", flipped: false },
    { label: "Starts after", stored: "start_before", flipped: true },
    { label: "Finishes before", stored: "finish_before", flipped: false },
    { label: "Finishes after", stored: "finish_before", flipped: true },
  ] as const;
  const targets: TestTask[] = [];
  for (const kind of kinds) {
    targets.push(
      await createTask(api, project.id, {
        title: uniqueName(`Target ${kind.label}`),
      }),
    );
  }

  await openTaskPage(page, taskPagePath(project.id, main.id));
  await expect(page.getByText("No related tasks")).toBeVisible();

  for (const [index, kind] of kinds.entries()) {
    const target = targets[index];
    if (!target) throw new Error(`no target for ${kind.label}`);
    await page.getByRole("button", { name: "Add relation" }).first().click();
    const picker = page
      .getByRole("dialog")
      .filter({ has: page.getByPlaceholder("Search tasks to link...") });
    await expect(picker).toBeVisible();
    await picker.getByRole("combobox", { name: "Relation" }).click();
    await page.getByRole("option", { name: kind.label, exact: true }).click();
    await expect(
      picker.getByRole("combobox", { name: "Relation" }),
    ).toContainText(kind.label);
    await picker.getByPlaceholder("Search tasks to link...").fill(target.title);
    await picker
      .getByRole("option", { name: new RegExp(escapeRegExp(target.title)) })
      .click();
    await expect(picker).toBeHidden();
    await expect(
      page.getByRole("button", {
        name: `${key(target)} ${target.title}`,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(kind.label, { exact: true }).first(),
    ).toBeVisible();
  }

  const relations = await listRelations(api, main.id);
  expect(relations).toHaveLength(kinds.length);
  for (const [index, kind] of kinds.entries()) {
    const target = targets[index];
    if (!target) throw new Error(`no target for ${kind.label}`);
    const match = relations.find(
      (relation) =>
        relation.relationType === kind.stored &&
        (kind.flipped
          ? relation.sourceTaskId === target.id &&
            relation.targetTaskId === main.id
          : relation.sourceTaskId === main.id &&
            relation.targetTaskId === target.id),
    );
    expect(match, `${kind.label} relation`).toBeTruthy();
  }

  // The other side reads the inverse: the blocked task is "Blocked by" main.
  const [blocked, , related] = targets;
  if (!blocked || !related) throw new Error("targets missing");
  await openTaskPage(page, taskPagePath(project.id, blocked.id));
  await expect(page.getByText("Blocked by", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${key(main)} ${main.title}` }),
  ).toBeVisible();

  // Remove "Relates to" from the main task's context menu.
  await openTaskPage(page, taskPagePath(project.id, main.id));
  await page
    .getByRole("button", { name: `${key(related)} ${related.title}` })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove relation" }).click();
  await expect(
    page.getByRole("button", { name: `${key(related)} ${related.title}` }),
  ).toHaveCount(0);
  await expect
    .poll(async () => (await listRelations(api, main.id)).length)
    .toBe(kinds.length - 1);
  await expect(
    page.getByText(/removed the relates to relation with/).first(),
  ).toBeVisible();
});

test("the parent picker sets and removes a parent", async ({ page, api }) => {
  const parent = await createTask(api, project.id, {
    title: uniqueName("Epic parent"),
  });
  const child = await createTask(api, project.id, {
    title: uniqueName("Child work"),
  });

  await openTaskPage(page, taskPagePath(project.id, child.id));
  await page.getByRole("button", { name: "Add parent" }).click();
  const picker = openPopover(page);
  await picker
    .getByRole("textbox", { name: "Search tasks…" })
    .fill(parent.title);
  await picker
    .getByRole("button", { name: new RegExp(escapeRegExp(parent.title)) })
    .click();
  await expect(toast(page, `Parent set to ${key(parent)}`)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `Subtask of ${key(parent)} ${parent.title}`,
    }),
  ).toBeVisible();
  const relations = await listRelations(api, child.id);
  expect(
    relations.some(
      (relation) =>
        relation.relationType === "subtask" &&
        relation.sourceTaskId === parent.id &&
        relation.targetTaskId === child.id,
    ),
  ).toBe(true);

  // The parent lists the child as a sub-task.
  await page
    .getByRole("button", { name: `Subtask of ${key(parent)} ${parent.title}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/task/${parent.id}`));
  await expect(page.getByRole("button", { name: child.title })).toBeVisible();

  // Remove it again from the child.
  await openTaskPage(page, taskPagePath(project.id, child.id));
  await page
    .getByRole("button", { name: new RegExp(`^${escapeRegExp(key(parent))}`) })
    .first()
    .click();
  await openPopover(page)
    .getByRole("button", { name: "Remove parent" })
    .click();
  await expect(toast(page, "Parent removed")).toBeVisible();
  await expect(page.getByText("Subtask of")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add parent" })).toBeVisible();
});

test("links are added, edited and removed", async ({ page, api }) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Linked task"),
  });
  await openTaskPage(page, taskPagePath(project.id, task.id));

  await page.getByRole("button", { name: "Add link" }).first().click();
  let dialog = page.getByRole("dialog", { name: "Add link" });
  await expect(dialog).toBeVisible();

  // Validation first.
  await dialog.getByLabel("URL").fill("ftp://example.com/file");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(
    dialog.getByText("Enter a valid http or https URL"),
  ).toBeVisible();

  await dialog.getByLabel("URL").fill("https://example.com/spec");
  await dialog.getByLabel("Title").fill("Product spec");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(toast(page, "Link added")).toBeVisible();
  const link = page.getByRole("link", { name: /Product spec/ });
  await expect(link).toHaveAttribute("href", "https://example.com/spec");

  // Edit
  await link.hover();
  await page.getByRole("button", { name: "Link actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  dialog = page.getByRole("dialog", { name: "Edit link" });
  await expect(dialog.getByLabel("URL")).toHaveValue(
    "https://example.com/spec",
  );
  await dialog.getByLabel("Title").fill("Product spec v2");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Link updated")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Product spec v2/ }),
  ).toBeVisible();

  const links = await readJson<{ url: string; title: string | null }[]>(
    await api.get(`/api/task-link/${task.id}`),
    "list links",
  );
  expect(links).toEqual([
    expect.objectContaining({
      url: "https://example.com/spec",
      title: "Product spec v2",
    }),
  ]);

  // Remove
  await page.getByRole("link", { name: /Product spec v2/ }).hover();
  await page.getByRole("button", { name: "Link actions" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove this link?" });
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(toast(page, "Link removed")).toBeVisible();
  await expect(page.getByRole("link", { name: /Product spec/ })).toHaveCount(0);
  await expect(
    page.getByText("added the link Product spec", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/removed the link Product spec v2/),
  ).toBeVisible();
});

async function storageConfigured(api: APIRequestContext, taskId: string) {
  const response = await api.post(`/api/task-attachment/${taskId}/upload`, {
    data: { filename: "probe.txt", contentType: "text/plain", size: 5 },
  });
  return response.status() !== 503;
}

test("a small file is attached, downloaded and deleted", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("Attachment task"),
  });
  test.skip(
    !(await storageConfigured(api, task.id)),
    "The e2e API has no S3 storage configured (S3_ENDPOINT/S3_BUCKET).",
  );
  await openTaskPage(page, taskPagePath(project.id, task.id));

  const chooser = page.waitForEvent("filechooser");
  // The action bar's "Attach file" (the description has an icon-only one).
  await page
    .getByRole("button", { name: "Attach file" })
    .filter({ hasText: "Attach file" })
    .click();
  await (await chooser).setFiles(FIXTURE);
  await expect(toast(page, "Attached 1 file")).toBeVisible();
  await expect(page.getByText("attachment-note.txt").first()).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download" }).first().click();
  expect((await download).suggestedFilename()).toBe("attachment-note.txt");

  await page
    .getByRole("button", { name: "Delete", exact: true })
    .first()
    .click();
  await page
    .getByRole("alertdialog", { name: "Delete attachment-note.txt?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(toast(page, "Attachment deleted")).toBeVisible();
  await expect(
    page.getByText(/removed the attachment attachment-note\.txt/),
  ).toBeVisible();
});

test("without storage, attaching a file says uploads are not set up", async ({
  page,
  api,
}) => {
  const task = await createTask(api, project.id, {
    title: uniqueName("No storage task"),
  });
  test.skip(
    await storageConfigured(api, task.id),
    "Storage is configured; the upload test covers this server.",
  );
  await openTaskPage(page, taskPagePath(project.id, task.id));

  const chooser = page.waitForEvent("filechooser");
  // The action bar's "Attach file" (the description has an icon-only one).
  await page
    .getByRole("button", { name: "Attach file" })
    .filter({ hasText: "Attach file" })
    .click();
  await (await chooser).setFiles(FIXTURE);
  await expect(
    toast(
      page,
      "File uploads aren't set up on this server. Ask your administrator to configure storage.",
    ),
  ).toBeVisible();
  const attachments = await readJson<unknown[]>(
    await api.get(`/api/task-attachment/${task.id}`),
    "list attachments",
  );
  expect(attachments).toHaveLength(0);
});

test("a sub-task created in the sheet shows on the board", async ({
  page,
  api,
}) => {
  const parent = await createTask(api, project.id, {
    title: uniqueName("Sheet parent"),
  });
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);
  await taskCard(page, parent.title).click();
  const sheet = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: "Add subtask" }) });
  await sheet.getByRole("button", { name: "Add subtask" }).click();
  const title = uniqueName("Sheet child");
  await sheet.getByPlaceholder("Subtask title...").fill(title);
  await sheet.getByPlaceholder("Subtask title...").press("Enter");
  await expect(sheet.getByRole("button", { name: title })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(taskCard(page, title)).toBeVisible();
  const child = (await listBoard(api, project.id)).columns
    .flatMap((column) => column.tasks)
    .find((task) => task.title === title);
  expect(child).toBeTruthy();
  expect((await getTask(api, child?.id ?? "")).status).toBe("to-do");
});

test("the sheet steps between tasks and switches to the page and back", async ({
  page,
  api,
}) => {
  const first = await createTask(api, project.id, {
    title: uniqueName("Step one"),
  });
  const second = await createTask(api, project.id, {
    title: uniqueName("Step two"),
  });
  await page.goto(boardPath(project.id));
  await waitForBoardReady(page);
  await taskCard(page, first.title).click();
  const sheet = taskSheet(page);
  const title = sheet.getByRole("textbox", { name: "Click to add a title" });
  await expect(title).toHaveValue(first.title, { timeout: 30_000 });
  await expect(sheet.getByText("of 2", { exact: false })).toBeVisible();

  // Two tasks on the board: exactly one direction leads to the other.
  const previous = sheet.getByRole("button", { name: "Previous task" });
  const next = sheet.getByRole("button", { name: "Next task" });
  const step = (await next.isEnabled()) ? next : previous;
  await expect(step).toBeEnabled();
  await step.click();
  await expect(title).toHaveValue(second.title, { timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`taskId=${second.id}`));

  // Sheet → page
  await sheet.getByRole("button", { name: "Open in full page" }).click();
  await expect(page).toHaveURL(new RegExp(`/task/${second.id}`));
  await expect(
    page.getByRole("textbox", { name: "Click to add a title" }),
  ).toHaveValue(second.title, { timeout: 30_000 });
  await expect(
    page
      .getByRole("region", { name: "Properties" })
      .getByText("Status", { exact: true }),
  ).toBeVisible();

  // Page → sheet over the board
  await page.getByRole("button", { name: "Open on the board" }).click();
  await expect(page).toHaveURL(new RegExp(`/board\\?taskId=${second.id}`));
  await expect(
    taskSheet(page).getByRole("textbox", { name: "Click to add a title" }),
  ).toHaveValue(second.title, { timeout: 30_000 });
});
