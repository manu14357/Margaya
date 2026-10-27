import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  type Project,
  type World,
} from "../../helpers/api-kit";
import {
  type AppNotification,
  browserContextFor,
  listNotifications,
  mention,
  openApp,
  settle,
  UI_TIMEOUT,
  waitForNotification,
} from "../../helpers/notifications";
import { uniqueName } from "../../helpers/ui";

// In-app notifications end to end: who is notified by assignments, mentions
// (description and comment) and status changes, never the actor; then the
// bell in the web app for the recipient, with mark read and mark all read.

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("In-app");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

const forTask = (taskId: string, type: string) => (entry: AppNotification) =>
  entry.resourceId === taskId && entry.type === type;

async function noneFor(
  role: "owner" | "admin" | "member" | "viewer",
  taskId: string,
  type: string,
) {
  await settle(world.as(role));
  const found = (await listNotifications(world.as(role))).filter(
    forTask(taskId, type),
  );
  expect(found, `${role} must not get ${type}`).toEqual([]);
}

test("assigning a task notifies the assignee, not the actor", async () => {
  const task = await createTask(world.as("owner"), project.id, {
    title: uniqueName("Assign me"),
  });
  await expectJson(
    await world.as("admin").put(`/api/task/assignees/${task.id}`, {
      data: { assigneeIds: [world.users.member.id] },
    }),
  );
  const notification = await waitForNotification(
    world.as("member"),
    forTask(task.id, "task_assignee_changed"),
    "the assignment notification",
  );
  expect(notification).toMatchObject({
    isRead: false,
    actorId: world.users.admin.id,
    workspaceId: world.workspace.id,
    resourceType: "task",
  });
  expect(notification.eventData).toMatchObject({
    taskTitle: task.title,
    taskKey: `${project.slug}-${task.number}`,
    projectId: project.id,
    actorName: world.users.admin.name,
  });
  await noneFor("admin", task.id, "task_assignee_changed");
  await noneFor("viewer", task.id, "task_assignee_changed");

  // Assigning yourself notifies nobody.
  const own = await createTask(world.as("owner"), project.id);
  await expectJson(
    await world.as("admin").put(`/api/task/assignees/${own.id}`, {
      data: { assigneeIds: [world.users.admin.id] },
    }),
  );
  await noneFor("admin", own.id, "task_assignee_changed");
});

test("a mention in a description notifies the mentioned user, not the author", async () => {
  const task = await createTask(world.as("owner"), project.id, {
    title: uniqueName("Describe me"),
  });
  await expectJson(
    await world.as("member").put(`/api/task/description/${task.id}`, {
      data: {
        description: `<p>Can you check this, ${mention(world.users.admin)}?</p>`,
      },
    }),
  );
  const notification = await waitForNotification(
    world.as("admin"),
    forTask(task.id, "task_mention"),
    "the description mention",
  );
  expect(notification.actorId).toBe(world.users.member.id);
  expect(notification.eventData).toMatchObject({
    source: "description",
    mentionerName: world.users.member.name,
    taskTitle: task.title,
  });
  await noneFor("member", task.id, "task_mention");
  await noneFor("viewer", task.id, "task_mention");

  // Saving the same mention again does not notify twice.
  await expectJson(
    await world.as("member").put(`/api/task/description/${task.id}`, {
      data: { description: `<p>Still: ${mention(world.users.admin)}</p>` },
    }),
  );
  await settle(world.as("admin"));
  const mentions = (await listNotifications(world.as("admin"))).filter(
    forTask(task.id, "task_mention"),
  );
  expect(mentions).toHaveLength(1);
});

test("a mention in a comment notifies the mentioned user; watchers hear about the comment", async () => {
  const task = await createTask(world.as("owner"), project.id, {
    title: uniqueName("Comment on me"),
    assigneeIds: [world.users.member.id],
  });
  await expectJson(
    await world.as("admin").post(`/api/comment/${task.id}`, {
      data: { content: `<p>${mention(world.users.viewer)} please review</p>` },
    }),
  );
  const mentioned = await waitForNotification(
    world.as("viewer"),
    forTask(task.id, "task_mention"),
    "the comment mention",
  );
  expect(mentioned.eventData).toMatchObject({
    source: "comment",
    mentionerName: world.users.admin.name,
  });

  // The assignee (and the creator, who watches) get the comment itself.
  const comment = await waitForNotification(
    world.as("member"),
    forTask(task.id, "task_comment"),
    "the assignee's comment notification",
  );
  expect(comment.eventData).toMatchObject({
    commenterName: world.users.admin.name,
  });
  await waitForNotification(
    world.as("owner"),
    forTask(task.id, "task_comment"),
    "the creator's comment notification",
  );
  // The mentioned user is not notified twice for one comment.
  await noneFor("viewer", task.id, "task_comment");
  await noneFor("admin", task.id, "task_comment");
  await noneFor("admin", task.id, "task_mention");
});

test("a status change on an assigned task notifies the assignee and watchers, not the actor", async () => {
  const task = await createTask(world.as("owner"), project.id, {
    title: uniqueName("Move me"),
    assigneeIds: [world.users.member.id],
  });
  await expectJson(
    await world
      .as("admin")
      .put(`/api/task/status/${task.id}`, { data: { status: "in-progress" } }),
  );
  const notification = await waitForNotification(
    world.as("member"),
    forTask(task.id, "task_status_changed"),
    "the status notification",
  );
  expect(notification.eventData).toMatchObject({
    oldStatus: "to-do",
    newStatus: "in-progress",
    taskTitle: task.title,
  });
  expect(notification.actorId).toBe(world.users.admin.id);
  // The creator watches the task.
  await waitForNotification(
    world.as("owner"),
    forTask(task.id, "task_status_changed"),
    "the creator's status notification",
  );
  await noneFor("admin", task.id, "task_status_changed");
  await noneFor("viewer", task.id, "task_status_changed");

  // The assignee moving it themselves hears nothing new.
  await expectJson(
    await world
      .as("member")
      .put(`/api/task/status/${task.id}`, { data: { status: "done" } }),
  );
  await settle(world.as("member"));
  const statusNotes = (await listNotifications(world.as("member"))).filter(
    forTask(task.id, "task_status_changed"),
  );
  expect(statusNotes).toHaveLength(1);
});

test("the bell shows the recipient's notifications; mark one read, then mark all read", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  // A fresh recipient so the bell starts empty.
  const recipient = world.users.viewer;
  await expectJson(await recipient.ctx.delete("/api/notification/clear-all"));
  const tasks = [
    await createTask(world.as("owner"), project.id, {
      title: uniqueName("Bell one"),
    }),
    await createTask(world.as("owner"), project.id, {
      title: uniqueName("Bell two"),
    }),
  ];
  for (const task of tasks) {
    await expectJson(
      await world.as("owner").put(`/api/task/assignees/${task.id}`, {
        data: { assigneeIds: [recipient.id] },
      }),
    );
    await waitForNotification(
      recipient.ctx,
      forTask(task.id, "task_assignee_changed"),
    );
  }

  const context = await browserContextFor(browser, recipient);
  try {
    const page = await context.newPage();
    await openApp(page, `/dashboard/workspace/${world.workspace.id}`);
    const bell = page.getByRole("button", { name: /Notifications/ }).first();
    await expect(bell).toBeVisible({ timeout: UI_TIMEOUT });
    // The unread badge counts both.
    await expect(bell).toContainText("2");

    await bell.click();
    const menu = page.getByRole("menu");
    await expect(
      menu.getByText("Notifications", { exact: true }),
    ).toBeVisible();
    for (const task of tasks) {
      await expect(
        menu.getByText(`You have been assigned to task: ${task.title}`),
      ).toBeVisible();
    }
    await expect(menu.getByText("Task assigned to you")).toHaveCount(2);

    // Clicking one marks it read and opens the task.
    await menu
      .getByText(`You have been assigned to task: ${tasks[0]?.title}`)
      .click();
    await expect(page).toHaveURL(new RegExp(`/task/${tasks[0]?.id}`), {
      timeout: UI_TIMEOUT,
    });
    // The URL commits before the lazily loaded task page renders, and that
    // page brings its own header (and bell). Opening the old bell meanwhile
    // loses the menu when the header is replaced.
    await expect(page.getByPlaceholder("Click to add a title")).toHaveValue(
      tasks[0]?.title ?? "",
      { timeout: UI_TIMEOUT },
    );
    await expect(bell).toContainText("1", { timeout: 30_000 });
    // The badge updates optimistically; the stored state follows.
    const readState = async (taskId: string | undefined) =>
      (await listNotifications(recipient.ctx)).find(
        forTask(taskId ?? "", "task_assignee_changed"),
      )?.isRead;
    await expect
      .poll(() => readState(tasks[0]?.id), { timeout: 30_000 })
      .toBe(true);
    expect(await readState(tasks[1]?.id)).toBe(false);

    await bell.click();
    await page.getByRole("menuitem", { name: "Mark all read" }).click();
    await expect
      .poll(
        async () =>
          (await listNotifications(recipient.ctx)).filter(
            (entry) => !entry.isRead,
          ).length,
        { timeout: 30_000 },
      )
      .toBe(0);
    await expect(
      page.getByRole("menuitem", { name: "Mark all read" }),
    ).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(bell).not.toContainText(/\d/);
  } finally {
    await context.close();
  }
});

test("a new notification reaches an open bell without a reload", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const recipient = world.users.viewer;
  const context = await browserContextFor(browser, recipient);
  try {
    const page = await context.newPage();
    await openApp(page, `/dashboard/workspace/${world.workspace.id}`);
    const bell = page.getByRole("button", { name: /Notifications/ }).first();
    await expect(bell).toBeVisible({ timeout: UI_TIMEOUT });
    await expect(bell).not.toContainText(/\d/);

    const task = await createTask(world.as("owner"), project.id, {
      title: uniqueName("Live bell"),
    });
    await expectJson(
      await world.as("owner").put(`/api/task/assignees/${task.id}`, {
        data: { assigneeIds: [recipient.id] },
      }),
    );
    await expect(bell).toContainText("1", { timeout: 30_000 });
    await bell.click();
    await expect(
      page
        .getByRole("menu")
        .getByText(`You have been assigned to task: ${task.title}`),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
