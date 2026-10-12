import { beforeEach, describe, expect, it, vi } from "vitest";
import createComment from "../../apps/api/src/activity/controllers/create-comment";
import { publishEvent } from "../../apps/api/src/events";
import createTask from "../../apps/api/src/task/controllers/create-task";
import importTasks from "../../apps/api/src/task/controllers/import-tasks";
import { updateTaskAssigneesController } from "../../apps/api/src/task/controllers/update-task-assignees";
import updateTaskDescription from "../../apps/api/src/task/controllers/update-task-description";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  expectSubscription,
  inboxScene,
  mentionOf,
  recordEvents,
  subscriptionRow,
} from "./helpers/inbox";

vi.mock("../../apps/api/src/notification-preferences/delivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

const changes = recordEvents("task.subscription_changed");

beforeEach(async () => {
  await resetTestDatabase();
  changes.length = 0;
});

type Subscription = {
  taskId: string;
  subscribed: boolean;
  reason: string | null;
  isAssignee: boolean;
  isMuted: boolean;
  subscriberCount: number;
};

describe("auto-subscribe", () => {
  it("subscribes the creator and the assignees of an interactive create", async () => {
    const { ada, ben, project } = await inboxScene();
    const created = await createTask({
      projectId: project.id,
      currentUserId: ada.id,
      assigneeIds: [ada.id, ben.id],
      title: "Mine",
      status: "to-do",
    });
    await expectSubscription(created.id, ada.id, {
      subscribed: true,
      reason: "creator",
    });
    await expectSubscription(created.id, ben.id, {
      subscribed: true,
      reason: "assignee",
    });
  });

  it("subscribes imported assignees but not the importer", async () => {
    const { ada, ben, project } = await inboxScene();
    const result = await importTasks(
      project.id,
      [{ title: "Imported", status: "to-do", assigneeIds: [ben.id] }],
      ada.id,
    );
    const taskId = (result.results.tasks[0] as { task: { id: string } }).task
      .id;
    await expectSubscription(taskId, ben.id, {
      subscribed: true,
      reason: "assignee",
    });
    expect(await subscriptionRow(taskId, ada.id)).toBeNull();
  });

  it("subscribes only the assignees of an integration-created task", async () => {
    const { ada, ben, project, task } = await inboxScene();
    const target = await task([ben.id]);
    await publishEvent(
      "task.created",
      {
        taskId: target.id,
        projectId: project.id,
        userId: ben.id,
        type: "task",
        source: "gitea",
      },
      { waitForHandlers: true },
    );
    await expectSubscription(target.id, ben.id, {
      subscribed: true,
      reason: "assignee",
    });
    expect(await subscriptionRow(target.id, ada.id)).toBeNull();
  });

  it("subscribes a newly added assignee", async () => {
    const { ada, cid, task } = await inboxScene();
    const target = await task([]);
    await updateTaskAssigneesController({
      id: target.id,
      add: [cid.id],
      currentUserId: ada.id,
    });
    await expectSubscription(target.id, cid.id, {
      subscribed: true,
      reason: "assignee",
    });
    // Editing does not subscribe the editor (K3).
    expect(await subscriptionRow(target.id, ada.id)).toBeNull();
  });

  it("subscribes a comment's author, but not for an imported comment", async () => {
    const { ben, cid, task } = await inboxScene();
    const target = await task([]);
    await createComment(target.id, ben.id, "Looks good");
    expect(await subscriptionRow(target.id, ben.id)).toEqual({
      subscribed: true,
      reason: "commenter",
    });
    await createComment(target.id, cid.id, "From elsewhere", {
      userName: "Outside Person",
      source: "gitea",
    });
    expect(await subscriptionRow(target.id, cid.id)).toBeNull();
  });

  it("subscribes mentioned members only: comments, description edits and new tasks", async () => {
    const { ada, ben, cid, project, task } = await inboxScene();
    const outsider = (await createWorkspaceMember({ userName: "Out" })).user;
    const target = await task([]);

    await createComment(
      target.id,
      ada.id,
      `${mentionOf(ben)} ${mentionOf(outsider)} <margaya-mention id="nobody" label="x"></margaya-mention>`,
    );
    expect(await subscriptionRow(target.id, ben.id)).toEqual({
      subscribed: true,
      reason: "mention",
    });
    expect(await subscriptionRow(target.id, outsider.id)).toBeNull();

    await updateTaskDescription({
      id: target.id,
      description: `Over to ${mentionOf(cid)}`,
      currentUserId: ada.id,
    });
    expect(await subscriptionRow(target.id, cid.id)).toEqual({
      subscribed: true,
      reason: "mention",
    });

    const created = await createTask({
      projectId: project.id,
      currentUserId: ada.id,
      title: "Hello",
      status: "to-do",
      description: `Hi ${mentionOf(ben)}`,
    });
    await expectSubscription(created.id, ben.id, {
      subscribed: true,
      reason: "mention",
    });
  });

  it("subscribes an intake request's submitter", async () => {
    const { ben, task } = await inboxScene();
    const target = await task([]);
    await publishEvent(
      "intake.item_created",
      { taskId: target.id, userId: ben.id, workspaceId: "w" },
      { waitForHandlers: true },
    );
    expect(await subscriptionRow(target.id, ben.id)).toEqual({
      subscribed: true,
      reason: "creator",
    });
  });
});

describe("subscription routes", () => {
  it("subscribes and unsubscribes idempotently", async () => {
    const { ben, task, call } = await inboxScene();
    const target = await task([]);
    const path = `/subscription/task/${target.id}`;

    const initial = (await (
      await call(ben, "GET", path)
    ).json()) as Subscription;
    expect(initial).toEqual({
      taskId: target.id,
      subscribed: false,
      reason: null,
      isAssignee: false,
      isMuted: false,
      subscriberCount: 0,
    });

    const put = await call(ben, "PUT", path);
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({
      subscribed: true,
      reason: "manual",
      subscriberCount: 1,
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      taskId: target.id,
      userId: ben.id,
      subscribed: true,
    });

    expect((await call(ben, "PUT", path)).status).toBe(200);
    expect(changes).toHaveLength(1);

    const del = await call(ben, "DELETE", path);
    expect(await del.json()).toMatchObject({
      subscribed: false,
      reason: null,
      isMuted: true,
      subscriberCount: 0,
    });
    expect(changes).toHaveLength(2);
    expect((await call(ben, "DELETE", path)).status).toBe(200);
    expect(changes).toHaveLength(2);
  });

  it("reports assignees, muted assignees and the watcher count", async () => {
    const { ada, ben, cid, task, call } = await inboxScene();
    const target = await task([ada.id, ben.id]);
    const path = `/subscription/task/${target.id}`;
    await call(cid, "PUT", path);

    expect(await (await call(ada, "GET", path)).json()).toEqual({
      taskId: target.id,
      subscribed: true,
      reason: "assignee",
      isAssignee: true,
      isMuted: false,
      subscriberCount: 3,
    });

    const muted = (await (
      await call(ben, "DELETE", path)
    ).json()) as Subscription;
    expect(muted).toMatchObject({
      subscribed: false,
      isAssignee: true,
      isMuted: true,
      subscriberCount: 2,
    });
  });

  it("re-subscribes a muted user who comments, is mentioned or is assigned", async () => {
    const { ada, ben, cid, task, call } = await inboxScene();
    const target = await task([]);
    const path = `/subscription/task/${target.id}`;
    for (const user of [ada, ben, cid]) await call(user, "DELETE", path);

    await createComment(target.id, ada.id, "Back in");
    expect(await subscriptionRow(target.id, ada.id)).toEqual({
      subscribed: true,
      reason: "commenter",
    });

    await createComment(target.id, ada.id, `Hey ${mentionOf(ben)}`);
    expect(await subscriptionRow(target.id, ben.id)).toEqual({
      subscribed: true,
      reason: "mention",
    });

    await updateTaskAssigneesController({
      id: target.id,
      add: [cid.id],
      currentUserId: ada.id,
    });
    await expectSubscription(target.id, cid.id, {
      subscribed: true,
      reason: "assignee",
    });
  });

  it("lets viewers subscribe and refuses other workspaces", async () => {
    const { task, call, person } = await inboxScene();
    const viewer = await person("Vera", "viewer");
    const target = await task([]);
    const path = `/subscription/task/${target.id}`;
    expect((await call(viewer, "PUT", path)).status).toBe(200);

    const stranger = await createWorkspaceMember({ userName: "Stranger" });
    expect((await call(stranger.user, "GET", path)).status).toBe(403);
    expect((await call(stranger.user, "PUT", path)).status).toBe(403);
  });
});
