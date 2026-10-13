import { createHmac } from "node:crypto";
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
import { settle } from "../../helpers/notifications";
import { uniqueName } from "../../helpers/ui";
import type { ReceivedRequest } from "../../helpers/webhook-sink";

// Outgoing webhooks, received by the local sink: a project's generic webhook
// integration (task events, HMAC-signed with X-Margaya-Signature) and the
// webhook channel of a user's notification preferences.

type ProjectEvent = {
  event: string;
  timestamp: string;
  integration: { type: string };
  project: { id: string; name: string; workspaceId: string };
  task: {
    id: string;
    number?: number;
    title: string;
    status?: string;
    priority?: string;
    url?: string;
    assigneeIds?: string[];
  };
  actor: { id: string | null; name: string | null };
  data: Record<string, unknown>;
};

let world: World;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Webhooks");
});

test.afterAll(async () => {
  await world?.dispose();
});

const signature = (secret: string, body: string) =>
  createHmac("sha256", secret).update(body).digest("hex");

test("a project's generic webhook receives signed task events", async ({
  webhookSink,
}) => {
  const owner = world.as("owner");
  const admin = world.as("admin");
  const project: Project = await createProject(owner, world.workspace.id);
  const secret = `e2e-signing-secret-${Date.now()}`;
  const path = "/project-hook";
  await expectJson(
    await owner.post(`/api/generic-webhook-integration/project/${project.id}`, {
      data: {
        webhookUrl: `${webhookSink.url}${path}`,
        secret,
        events: {
          taskCreated: true,
          taskStatusChanged: true,
          taskPriorityChanged: true,
          taskTitleChanged: true,
          taskCommentCreated: true,
          taskDeleted: true,
          taskAssigneeChanged: true,
          taskDueDateChanged: true,
        },
      },
    }),
  );

  const received = (event: string, taskId: string) =>
    webhookSink.waitForRequest(
      (request) =>
        request.path === path &&
        (request.json as ProjectEvent | undefined)?.event === event &&
        (request.json as ProjectEvent).task.id === taskId,
      15_000,
    );
  const expectSigned = (request: ReceivedRequest) => {
    expect(request.method).toBe("POST");
    expect(request.headers["content-type"]).toContain("application/json");
    const header = request.headers["x-margaya-signature"];
    expect(header).toBe(signature(secret, request.body));
    // A different secret would not verify.
    expect(header).not.toBe(signature(`${secret}x`, request.body));
  };

  const title = uniqueName("Hooked task");
  const task = await createTask(admin, project.id, { title, priority: "low" });
  const created = await received("task.created", task.id);
  expectSigned(created);
  const createdEvent = created.json as ProjectEvent;
  expect(createdEvent).toMatchObject({
    event: "task.created",
    integration: { type: "generic-webhook" },
    project: {
      id: project.id,
      name: project.name,
      workspaceId: world.workspace.id,
    },
    task: {
      id: task.id,
      number: task.number,
      title,
      status: "to-do",
      priority: "low",
      url: `${E2E_WEB_URL}/dashboard/workspace/${world.workspace.id}/project/${project.id}/task/${task.id}`,
    },
    data: { title, status: "to-do", priority: "low" },
  });
  // The creator as actor: see the known-bug test below.
  expect(Number.isNaN(Date.parse(createdEvent.timestamp))).toBe(false);

  await expectJson(
    await admin.put(`/api/task/status/${task.id}`, {
      data: { status: "in-review" },
    }),
  );
  const status = await received("task.status_changed", task.id);
  expectSigned(status);
  expect(status.json as ProjectEvent).toMatchObject({
    actor: { id: world.users.admin.id, name: world.users.admin.name },
    task: { status: "in-review" },
    data: { oldStatus: "to-do", newStatus: "in-review" },
  });

  await expectJson(
    await admin.put(`/api/task/priority/${task.id}`, {
      data: { priority: "urgent" },
    }),
  );
  expect(
    ((await received("task.priority_changed", task.id)).json as ProjectEvent)
      .data,
  ).toMatchObject({
    oldPriority: "low",
    newPriority: "urgent",
  });

  const renamed = uniqueName("Hooked renamed");
  await expectJson(
    await admin.put(`/api/task/title/${task.id}`, { data: { title: renamed } }),
  );
  expect(
    ((await received("task.title_changed", task.id)).json as ProjectEvent).data,
  ).toMatchObject({
    oldTitle: title,
    newTitle: renamed,
  });

  await expectJson(
    await admin.put(`/api/task/assignees/${task.id}`, {
      data: { assigneeIds: [world.users.member.id] },
    }),
  );
  const assigned = await received("task.assignee_changed", task.id);
  expectSigned(assigned);
  expect((assigned.json as ProjectEvent).task.assigneeIds).toEqual([
    world.users.member.id,
  ]);

  await expectJson(
    await admin.put(`/api/task/due-date/${task.id}`, {
      data: { dueDate: "2031-06-01T00:00:00.000Z" },
    }),
  );
  await received("task.due_date_changed", task.id);

  await expectJson(
    await world
      .as("member")
      .post(`/api/comment/${task.id}`, { data: { content: "Hooked comment" } }),
  );
  const comment = await received("task.comment_created", task.id);
  expect((comment.json as ProjectEvent).actor.id).toBe(world.users.member.id);
  expect(JSON.stringify((comment.json as ProjectEvent).data)).toContain(
    "Hooked comment",
  );

  await expectJson(await admin.delete(`/api/task/${task.id}`));
  const deleted = await received("task.deleted", task.id);
  expectSigned(deleted);
  expect((deleted.json as ProjectEvent).task).toMatchObject({
    id: task.id,
    title: renamed,
  });

  // Events switched off are not sent; a paused integration sends nothing.
  await expectJson(
    await owner.patch(
      `/api/generic-webhook-integration/project/${project.id}`,
      {
        data: { events: { taskCreated: false } },
      },
    ),
  );
  const silent = await createTask(admin, project.id);
  await expectJson(
    await admin.put(`/api/task/status/${silent.id}`, {
      data: { status: "done" },
    }),
  );
  await received("task.status_changed", silent.id);
  expect(
    webhookSink.requests.filter(
      (request) =>
        (request.json as ProjectEvent | undefined)?.event === "task.created" &&
        (request.json as ProjectEvent).task.id === silent.id,
    ),
  ).toEqual([]);

  await expectJson(
    await owner.patch(
      `/api/generic-webhook-integration/project/${project.id}`,
      { data: { isActive: false } },
    ),
  );
  const before = webhookSink.requests.length;
  const paused = await createTask(admin, project.id);
  await expectJson(
    await admin.put(`/api/task/status/${paused.id}`, {
      data: { status: "done" },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));
  expect(webhookSink.requests.slice(before)).toEqual([]);
});

test("the task.created webhook names the creator as its actor", async ({
  webhookSink,
}) => {
  // Regression: task.created once named the first assignee (or nobody) as
  // its actor instead of the creator.
  const owner = world.as("owner");
  const project = await createProject(owner, world.workspace.id);
  await expectJson(
    await owner.post(`/api/generic-webhook-integration/project/${project.id}`, {
      data: {
        webhookUrl: `${webhookSink.url}/actor`,
        events: { taskCreated: true },
      },
    }),
  );
  // Assigned to someone else, and unassigned.
  for (const assigneeIds of [[world.users.member.id], []]) {
    const task = await createTask(world.as("admin"), project.id, {
      assigneeIds,
    });
    const created = await webhookSink.waitForRequest(
      (request) =>
        (request.json as ProjectEvent | undefined)?.task?.id === task.id,
    );
    expect((created.json as ProjectEvent).actor).toEqual({
      id: world.users.admin.id,
      name: world.users.admin.name,
    });
  }
});

test("the webhook channel of notification preferences receives the user's notifications", async ({
  webhookSink,
}) => {
  const owner = world.as("owner");
  const member = world.users.member;
  const project = await createProject(owner, world.workspace.id);
  const path = "/member-notifications";
  // Stored encrypted (NOTIFICATION_SECRET_ENCRYPTION_KEY, see helpers/env.ts)
  // and used to sign every delivery.
  const secret = `e2e-preference-secret-${Date.now()}`;
  const stored = await expectJson<Record<string, unknown>>(
    await member.ctx.put("/api/notification-preferences", {
      data: {
        webhookEnabled: true,
        webhookUrl: `${webhookSink.url}${path}`,
        webhookSecret: secret,
      },
    }),
  );
  expect(stored.webhookSecretConfigured).toBe(true);
  expect(JSON.stringify(stored)).not.toContain(secret);
  await expectJson(
    await member.ctx.put(
      `/api/notification-preferences/workspaces/${world.workspace.id}`,
      {
        data: {
          isActive: true,
          emailEnabled: false,
          ntfyEnabled: false,
          gotifyEnabled: false,
          webhookEnabled: true,
          projectMode: "selected",
          selectedProjectIds: [project.id],
        },
      },
    ),
  );

  type Delivery = {
    notification: {
      id: string;
      type: string;
      title: string;
      content: string;
      resourceId: string;
    };
    workspace: { id: string; name: string };
    project: { id: string; name: string } | null;
    task: { id: string; title: string; url: string } | null;
    user: { id: string; email: string; name: string };
  };
  const delivered = (taskId: string, type: string) =>
    webhookSink.waitForRequest(
      (request) =>
        request.path === path &&
        (request.json as Delivery | undefined)?.notification?.resourceId ===
          taskId &&
        (request.json as Delivery).notification.type === type,
      15_000,
    );

  const task = await createTask(owner, project.id, {
    title: uniqueName("Pinged task"),
  });
  await expectJson(
    await owner.put(`/api/task/assignees/${task.id}`, {
      data: { assigneeIds: [member.id] },
    }),
  );
  const request = await delivered(task.id, "task_assignee_changed");
  expect(request.method).toBe("POST");
  expect(request.headers["x-margaya-signature"]).toBe(
    signature(secret, request.body),
  );
  expect(request.json).toMatchObject({
    notification: {
      type: "task_assignee_changed",
      title: "Task assigned to you",
      content: `You were assigned to ${task.title}.`,
    },
    workspace: { id: world.workspace.id, name: world.workspace.name },
    project: { id: project.id, name: project.name },
    task: {
      id: task.id,
      title: task.title,
      url: `${E2E_WEB_URL}/dashboard/workspace/${world.workspace.id}/project/${project.id}/task/${task.id}`,
    },
    user: { id: member.id, email: member.email, name: member.name },
  });

  await expectJson(
    await world
      .as("admin")
      .put(`/api/task/status/${task.id}`, { data: { status: "in-progress" } }),
  );
  const status = await delivered(task.id, "task_status_changed");
  expect((status.json as Delivery).notification.content).toBe(
    `${task.title} moved from to-do to in-progress.`,
  );
  expect(status.headers["x-margaya-signature"]).toBe(
    signature(secret, status.body),
  );

  // Other projects are outside the rule; other users have no webhook.
  const elsewhere = await createProject(owner, world.workspace.id);
  const outside = await createTask(owner, elsewhere.id);
  await expectJson(
    await owner.put(`/api/task/assignees/${outside.id}`, {
      data: { assigneeIds: [member.id, world.users.admin.id] },
    }),
  );
  await settle(member.ctx);
  await settle(world.as("admin"));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const deliveries = webhookSink.requests.filter(
    (entry) => entry.path === path,
  );
  expect(
    deliveries.every((entry) => (entry.json as Delivery).user.id === member.id),
  ).toBe(true);
  expect(
    deliveries.filter(
      (entry) =>
        (entry.json as Delivery).notification.resourceId === outside.id,
    ),
  ).toEqual([]);

  // Without the secret, deliveries are no longer signed.
  const unsigned = await expectJson<Record<string, unknown>>(
    await member.ctx.put("/api/notification-preferences", {
      data: { webhookSecret: null },
    }),
  );
  expect(unsigned.webhookSecretConfigured).toBe(false);
  await expectJson(
    await world
      .as("admin")
      .put(`/api/task/status/${task.id}`, { data: { status: "done" } }),
  );
  const done = await webhookSink.waitForRequest(
    (entry) =>
      entry.path === path &&
      (entry.json as Delivery | undefined)?.notification?.content ===
        `${task.title} moved from in-progress to done.`,
    15_000,
  );
  expect(done.headers["x-margaya-signature"]).toBeUndefined();

  await expectJson(
    await member.ctx.put("/api/notification-preferences", {
      data: { webhookEnabled: false },
    }),
  );
});
