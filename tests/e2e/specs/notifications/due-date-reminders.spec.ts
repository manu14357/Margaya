import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { E2E_WEB_URL } from "../../helpers/env";
import { extractLinks } from "../../helpers/mailpit";
import {
  listNotifications,
  waitForMail,
  waitForNotification,
} from "../../helpers/notifications";
import { uniqueName } from "../../helpers/ui";

// Due-date reminders: the API's scheduler checks every 5 minutes (cron
// "*/5 * * * *"), so this spec waits for the next tick, up to about six
// minutes. One tick covers the assignee's "due soon" and "overdue"
// reminders (in-app and email) and the project webhook's reminder.

let world: World;
let project: Project;
/** Set by the first test once the scheduler has run. */
let lateTaskId: string | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Reminders");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test("due-soon and overdue reminders arrive in-app, by email and by project webhook", async ({
  mailpit,
  webhookSink,
}) => {
  test.setTimeout(9 * 60_000);
  const member = world.users.member;
  const LEAD_MINUTES = 5;
  await expectJson(
    await member.ctx.put("/api/notification-preferences", {
      data: {
        emailEnabled: true,
        dueDateReminderEnabled: true,
        dueDateReminderLeadTimeMinutes: LEAD_MINUTES,
      },
    }),
  );
  await expectJson(
    await member.ctx.put(
      `/api/notification-preferences/workspaces/${world.workspace.id}`,
      {
        data: {
          isActive: true,
          emailEnabled: true,
          ntfyEnabled: false,
          gotifyEnabled: false,
          webhookEnabled: false,
          projectMode: "all",
        },
      },
    ),
  );
  await expectJson(
    await world
      .as("owner")
      .post(`/api/generic-webhook-integration/project/${project.id}`, {
        data: {
          webhookUrl: `${webhookSink.url}/reminders`,
          events: { dueDateReminder: true, taskCreated: false },
          dueDateReminderLeadTimeMinutes: LEAD_MINUTES,
        },
      }),
  );

  const since = new Date(Date.now() - 1000);
  const now = Date.now();
  // Place every due date relative to the scheduler tick that will pick it
  // up: the next 5-minute boundary, at least 15 s away so setup finishes.
  const PERIOD = 5 * 60_000;
  const tick = Math.ceil((now + 15_000) / PERIOD) * PERIOD;
  const minute = 60_000;
  // Due a minute after the tick: its reminder time (due minus lead) falls
  // inside the tick's window.
  const soon = await createTask(world.as("owner"), project.id, {
    title: uniqueName("Due soon"),
    dueDate: new Date(tick + minute).toISOString(),
    assigneeIds: [member.id],
  });
  // Four minutes past due at the tick.
  const late = await createTask(world.as("owner"), project.id, {
    title: uniqueName("Overdue"),
    dueDate: new Date(tick - 4 * minute).toISOString(),
    assigneeIds: [member.id],
  });
  // Done tasks never remind.
  const finished = await createTask(world.as("owner"), project.id, {
    title: uniqueName("Finished"),
    status: "done",
    dueDate: new Date(tick - 4 * minute).toISOString(),
    assigneeIds: [member.id],
  });

  const nextTick = tick - Date.now();
  const timeoutMs = nextTick + 75_000;
  const waitFor = (taskId: string, type: string) =>
    expect
      .poll(
        async () =>
          (await listNotifications(member.ctx)).find(
            (entry) => entry.resourceId === taskId && entry.type === type,
          ) ?? null,
        { timeout: timeoutMs, intervals: [5_000] },
      )
      .not.toBeNull();

  await waitFor(soon.id, "due_date_reminder");
  await waitFor(late.id, "task_overdue");

  const reminder = await waitForNotification(
    member.ctx,
    (entry) =>
      entry.resourceId === soon.id && entry.type === "due_date_reminder",
  );
  expect(reminder.eventData).toMatchObject({
    taskTitle: soon.title,
    leadTimeMinutes: LEAD_MINUTES,
    reminderType: "configured_before",
  });

  const soonMail = await waitForMail(
    mailpit,
    { to: member.email, subject: "Task due soon", since },
    (message) => message.Text.includes(soon.title),
  );
  expect(soonMail.To.map((to) => to.Address)).toEqual([member.email]);
  // The text names the due day in the recipient's time zone (UTC here: the
  // member has not chosen one).
  const dueDay = String(reminder.eventData?.dueDay);
  expect(dueDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(soonMail.Text).toContain(
    `"${soon.title}" is due in ${LEAD_MINUTES} minutes (${dueDay}).`,
  );
  const taskUrl = `${E2E_WEB_URL}/dashboard/workspace/${world.workspace.id}/project/${project.id}/task/${soon.id}`;
  expect(extractLinks(soonMail)).toContain(taskUrl);
  expect((await fetch(taskUrl)).status).toBe(200);

  const lateMail = await waitForMail(
    mailpit,
    { to: member.email, subject: "Task overdue", since },
    (message) => message.Text.includes(late.title),
  );
  expect(lateMail.Text).toContain(`"${late.title}" is past its due date.`);

  const hook = await webhookSink.waitForRequest(
    (request) =>
      request.path === "/reminders" &&
      (request.json as { task?: { id?: string } } | undefined)?.task?.id ===
        soon.id,
    30_000,
  );
  expect(hook.json).toMatchObject({
    event: "task.due_date_reminder",
    task: { id: soon.id, title: soon.title },
    data: { leadTimeMinutes: LEAD_MINUTES },
  });

  // Each reminder is sent once; completed tasks never remind.
  const notifications = await listNotifications(member.ctx);
  expect(
    notifications.filter(
      (entry) =>
        entry.resourceId === soon.id && entry.type === "due_date_reminder",
    ),
  ).toHaveLength(1);
  const reminderTypes = ["due_date_reminder", "task_overdue"];
  expect(
    notifications.filter(
      (entry) =>
        entry.resourceId === finished.id && reminderTypes.includes(entry.type),
    ),
  ).toEqual([]);
  lateTaskId = late.id;
});

test("an already overdue task gets no 'due soon' reminder", async () => {
  // Regression: the previous test's "Overdue" task, 4 minutes past due at the
  // tick, once got "is due in 5 minutes" together with "is past its due
  // date". Only the overdue reminder may arrive.
  test.skip(!lateTaskId, "Needs the reminder tick of the previous test");
  const notifications = await listNotifications(world.users.member.ctx);
  const reminders = notifications.filter(
    (entry) =>
      entry.resourceId === lateTaskId &&
      ["due_date_reminder", "task_overdue"].includes(entry.type),
  );
  expect(reminders.map((entry) => entry.type)).toEqual(["task_overdue"]);
});
