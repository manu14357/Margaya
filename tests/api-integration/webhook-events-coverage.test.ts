import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { publishEvent } from "../../apps/api/src/events";
import {
  WEBHOOK_SOURCE_EVENTS,
  webhookSourceFor,
} from "../../apps/api/src/webhook/catalog";
import {
  startWebhookDispatcher,
  stopWebhookDispatcher,
} from "../../apps/api/src/webhook/dispatch/dispatcher";
import { settleWebhookEnqueues } from "../../apps/api/src/webhook/dispatch/enqueue";
import { resetTestDatabase } from "./helpers/database";
import {
  deliveryRows,
  type Receiver,
  startReceiver,
  webhookScene,
} from "./helpers/webhooks";

let receiver: Receiver;

beforeAll(async () => {
  receiver = await startReceiver();
});

afterAll(async () => {
  await receiver.close();
  startWebhookDispatcher();
});

beforeEach(async () => {
  stopWebhookDispatcher();
  process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
  await resetTestDatabase();
});

afterEach(() => {
  delete process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
});

type Body = {
  event: string;
  project: { id: string } | null;
  actor: { id: string; name: string } | null;
  data: Record<string, unknown>;
  changes: Record<string, unknown> | null;
};

async function scene() {
  const s = await webhookScene();
  const webhook = await s.createWebhook(s.ada, { url: receiver.url() });
  const projectId = s.web.project.id;
  const task = await s.createTask();
  const other = await s.createTask({ number: 2, title: "Other" });
  const cycle = await s.insertCycle();
  const module = await s.insertModule();
  const { estimate, points } = await s.insertEstimate();
  const [page] = await db
    .insert(schema.pageTable)
    .values({ workspaceId: s.workspaceId, projectId, title: "Doc" })
    .returning();
  const [view] = await db
    .insert(schema.savedViewTable)
    .values({ workspaceId: s.workspaceId, projectId, name: "Board" })
    .returning();
  const [comment] = await db
    .insert(schema.activityTable)
    .values({
      taskId: task.id,
      type: "comment",
      userId: s.mia.id,
      content: "Looks good",
    })
    .returning();
  const [entry] = await db
    .insert(schema.timeEntryTable)
    .values({
      taskId: task.id,
      userId: s.mia.id,
      startTime: new Date(),
      duration: 60,
    })
    .returning();
  if (!page || !view || !comment || !entry) throw new Error("fixtures");

  const user = s.mia.id;
  const onProject = { projectId, workspaceId: s.workspaceId, userId: user };
  const onTask = { taskId: task.id, projectId, userId: user };
  const onPage = {
    pageId: page.id,
    projectId,
    workspaceId: s.workspaceId,
    userId: user,
  };
  const onView = {
    viewId: view.id,
    projectId,
    workspaceId: s.workspaceId,
    userId: user,
    access: "workspace",
  };
  const label = { label: { name: "bug", color: "#ff0000" } };
  const relation = {
    id: "rel-1",
    sourceTaskId: task.id,
    targetTaskId: other.id,
    relationType: "blocks",
    taskId: task.id,
    projectId,
    userId: user,
    origin: "user",
    sourceTaskKey: "WEB-1",
    targetTaskKey: "WEB-2",
  };
  const link = {
    ...onTask,
    linkId: "link-1",
    url: "https://example.com",
    title: "Spec",
  };
  const attachment = {
    ...onTask,
    attachmentId: "att-1",
    filename: "a.png",
    size: 10,
    mimeType: "image/png",
  };
  const intake = {
    intakeItemId: "intake-1",
    taskId: task.id,
    projectId,
    workspaceId: s.workspaceId,
    userId: user,
  };

  const payloads: Record<string, Record<string, unknown>> = {
    "project.features_updated": {
      projectId,
      workspaceId: s.workspaceId,
      userId: user,
      enabled: ["intake"],
      disabled: [],
    },
    "project.automations_updated": {
      projectId,
      workspaceId: s.workspaceId,
      userId: user,
      changed: ["autoArchive"],
    },
    "project.archived": { projectId, workspaceId: s.workspaceId, userId: user },
    "project.unarchived": {
      projectId,
      workspaceId: s.workspaceId,
      userId: user,
    },
    "project.restored": {
      projectId,
      workspaceId: s.workspaceId,
      userId: user,
      taskCount: 1,
    },
    "publication.published": onProject,
    "publication.unpublished": onProject,
    "publication.updated": { ...onProject, changes: ["allowComments"] },
    "publication.link_rotated": onProject,
    "task.vote_changed": { ...onTask, value: 1, up: 2, down: 0 },
    "column.created": {
      projectId,
      columnId: s.web.columns.todo.id,
      userId: user,
    },
    "column.updated": {
      projectId,
      columnId: s.web.columns.todo.id,
      userId: user,
      changed: ["name"],
    },
    "column.deleted": { projectId, columnId: "gone", userId: user },
    "task.created": { ...onTask, userId: "", currentUserId: user },
    "task.updated": onTask,
    "task.deleted": { ...onTask, title: "Fix login", status: "to-do" },
    "task.restored": { ...onTask, title: "Fix login", status: "to-do" },
    "task.purged": { ...onTask, title: "Fix login", status: "to-do" },
    "task.moved": {
      taskId: task.id,
      userId: user,
      fromProjectId: s.api.project.id,
      toProjectId: projectId,
      oldStatus: "to-do",
      newStatus: "to-do",
    },
    "task.status_changed": { ...onTask, oldStatus: "to-do", newStatus: "done" },
    "task.priority_changed": {
      ...onTask,
      oldPriority: "low",
      newPriority: "high",
    },
    "task.title_changed": { ...onTask, oldTitle: "a", newTitle: "b" },
    "task.description_changed": {
      ...onTask,
      oldDescription: null,
      newDescription: "x",
    },
    "task.due_date_changed": {
      ...onTask,
      oldDueDate: null,
      newDueDate: new Date("2026-10-10T00:00:00Z"),
    },
    "task.start_date_changed": {
      ...onTask,
      oldStartDate: null,
      newStartDate: new Date("2026-10-01T00:00:00Z"),
    },
    "task.parent_changed": {
      ...onTask,
      oldParent: null,
      newParent: { id: other.id, key: "WEB-2", title: "Other" },
    },
    "task.assignee_changed": {
      ...onTask,
      newAssigneeId: s.vic.id,
      newAssignee: "Vic",
    },
    "task.unassigned": {
      ...onTask,
      oldAssigneeId: s.vic.id,
      oldAssignee: "Vic",
    },
    "task.label_assigned": { ...onTask, ...label },
    "task.label_created": { ...onTask, ...label },
    "task.label_unassigned": { ...onTask, ...label },
    "task.label_deleted": { ...onTask, ...label },
    "task.estimate_changed": {
      ...onTask,
      oldPointId: null,
      newPointId: points[0]?.id,
      newValue: "1",
      newType: "points",
    },
    "task.cycle_changed": {
      ...onTask,
      oldCycleId: null,
      oldCycleName: null,
      newCycleId: cycle.id,
      newCycleName: cycle.name,
    },
    "task.archived": onTask,
    "task.unarchived": onTask,
    "task.copied": {
      ...onTask,
      sourceTaskId: other.id,
      sourceTaskKey: "WEB-2",
      sourceTaskTitle: "Other",
    },
    "task-relation.created": relation,
    "task-relation.deleted": relation,
    "task.link_created": link,
    "task.link_updated": {
      ...link,
      oldUrl: "https://old.example.com",
      oldTitle: null,
    },
    "task.link_deleted": link,
    "task.attachment_added": attachment,
    "task.attachment_removed": attachment,
    "task.automation_applied": {
      projectId,
      workspaceId: s.workspaceId,
      rule: "auto_close",
      taskIds: [task.id],
      count: 1,
    },
    "comment.created": { ...onTask, id: comment.id },
    "comment.updated": { ...onTask, id: comment.id },
    "comment.deleted": { ...onTask, id: comment.id },
    "reaction.added": { ...onTask, commentId: comment.id, emoji: "👍" },
    "reaction.removed": { ...onTask, commentId: null, emoji: "👍" },
    "time-entry.created": {
      timeEntryId: entry.id,
      taskId: task.id,
      userId: user,
    },
    "cycle.created": { cycleId: cycle.id, projectId, userId: user },
    "cycle.updated": {
      cycleId: cycle.id,
      projectId,
      userId: user,
      changes: ["name"],
    },
    "cycle.archived": { cycleId: cycle.id, projectId, userId: user },
    "cycle.unarchived": { cycleId: cycle.id, projectId, userId: user },
    "cycle.deleted": { cycleId: "gone", projectId, userId: user, name: "Old" },
    "cycle.tasks_changed": {
      projectId,
      userId: user,
      cycleIds: [cycle.id],
      taskIds: [task.id],
    },
    "module.created": { moduleId: module.id, projectId, userId: user },
    "module.updated": {
      moduleId: module.id,
      projectId,
      userId: user,
      changes: ["status"],
    },
    "module.archived": { moduleId: module.id, projectId, userId: user },
    "module.unarchived": { moduleId: module.id, projectId, userId: user },
    "module.deleted": {
      moduleId: "gone",
      projectId,
      userId: user,
      name: "Old",
    },
    "module.tasks_changed": {
      moduleId: module.id,
      projectId,
      userId: user,
      added: [task.id],
      removed: [],
    },
    "module.links_changed": {
      moduleId: module.id,
      projectId,
      userId: user,
      action: "created",
      linkId: "ml-1",
    },
    "page.created": onPage,
    "page.updated": { ...onPage, changed: ["title"] },
    "page.content_updated": { ...onPage, contentVersion: 1 },
    "page.locked": onPage,
    "page.unlocked": onPage,
    "page.access_changed": {
      ...onPage,
      access: "public",
      affectedPageIds: [page.id],
    },
    "page.archived": { ...onPage, affectedPageIds: [page.id] },
    "page.unarchived": { ...onPage, affectedPageIds: [page.id] },
    "page.moved": {
      ...onPage,
      fromProjectId: s.api.project.id,
      toProjectId: projectId,
      pageIds: [page.id],
    },
    "page.version_restored": { ...onPage, versionId: "v1" },
    "page.deleted": { ...onPage, access: "public", title: "Doc" },
    "view.created": onView,
    "view.updated": { ...onView, changes: ["name"] },
    "view.deleted": onView,
    "intake.item_created": intake,
    "intake.item_updated": {
      ...intake,
      action: "accepted",
      previousStatus: "pending",
      status: "accepted",
    },
    "intake.item_deleted": intake,
    "estimate.created": { projectId, estimateId: estimate.id, userId: user },
    "estimate.updated": { projectId, estimateId: estimate.id, userId: user },
    "estimate.deleted": { projectId, estimateId: "gone", userId: user },
    "estimate.activated": { projectId, estimateId: estimate.id, userId: user },
    "estimate.tasks_remapped": {
      projectId,
      estimateId: estimate.id,
      userId: user,
      changedTaskCount: 3,
    },
  };
  return { s, webhook, projectId, payloads, task, page };
}

/** Publishes one internal event and returns the delivery it produced. */
async function deliver(
  webhookId: string,
  internal: string,
  payload: Record<string, unknown>,
) {
  const before = (await deliveryRows(webhookId)).length;
  await publishEvent(internal, payload);
  await settleWebhookEnqueues();
  const rows = await deliveryRows(webhookId);
  expect(rows.length, `${internal} queued nothing`).toBe(before + 1);
  const row = rows.at(-1);
  if (!row) throw new Error("missing");
  return { row, body: JSON.parse(row.body) as Body };
}

describe("every mapped internal event", () => {
  it("becomes its public event with the right entity, project and changes", async () => {
    const { s, webhook, projectId, payloads } = await scene();
    // project.purged is covered through the trash routes (trash-projects).
    const viaRoutes = [
      "project.created",
      "project.updated",
      "project.deleted",
      "project.purged",
    ];
    const missing = WEBHOOK_SOURCE_EVENTS.filter(
      (name) => !(name in payloads) && !viaRoutes.includes(name),
    );
    expect(missing, "add a fixture for each newly mapped event").toEqual([]);

    const results = new Map<string, Body>();
    for (const [internal, payload] of Object.entries(payloads)) {
      const source = webhookSourceFor(internal);
      const { row, body } = await deliver(webhook.id, internal, payload);
      expect(row.event, internal).toBe(source?.event);
      expect(row.entityType, internal).toBe(source?.entity);
      expect(body.project?.id, internal).toBe(projectId);
      expect(body.workspace, internal).toMatchObject({ id: s.workspaceId });
      results.set(internal, body);
    }

    expect(results.get("task.moved")?.changes).toEqual({
      project: { old: s.api.project.id, new: projectId },
      status: { old: "to-do", new: "to-do" },
    });
    expect(results.get("task.label_created")?.changes).toEqual({
      label: { name: "bug", color: "#ff0000" },
    });
    expect(results.get("task.estimate_changed")?.changes).toMatchObject({
      estimate: { old: null, new: { value: "1", type: "points" } },
    });
    expect(results.get("task-relation.created")?.changes).toEqual({
      relation: {
        type: "blocks",
        sourceTaskId: expect.any(String),
        targetTaskId: expect.any(String),
        sourceKey: "WEB-1",
        targetKey: "WEB-2",
      },
    });
    expect(results.get("task.link_updated")?.changes).toMatchObject({
      link: { old: { url: "https://old.example.com", title: null } },
    });
    expect(results.get("module.tasks_changed")?.changes).toMatchObject({
      tasks: { removed: [] },
    });
    expect(results.get("intake.item_updated")?.changes).toEqual({
      action: "accepted",
      status: { old: "pending", new: "accepted" },
    });
    expect(results.get("estimate.tasks_remapped")?.changes).toEqual({
      changedTaskCount: 3,
    });
    expect(results.get("cycle.tasks_changed")?.data).toMatchObject({
      cycleIds: [expect.any(String)],
      cycles: [{ name: "Sprint" }],
    });
    expect(results.get("cycle.deleted")?.data).toEqual({
      id: "gone",
      projectId,
      name: "Old",
    });
    expect(results.get("publication.updated")?.changes).toEqual({
      allowComments: null,
    });
    expect(results.get("task.vote_changed")?.changes).toEqual({
      vote: { value: 1, up: 2, down: 0 },
    });
    expect(results.get("comment.created")?.data).toMatchObject({
      visibility: "internal",
      origin: "app",
      content: "Looks good",
      taskKey: "WEB-1",
      author: { id: s.mia.id, name: "Mia" },
    });
    expect(results.get("reaction.added")?.data).toMatchObject({
      emoji: "👍",
      user: { id: s.mia.id, name: "Mia" },
    });
    expect(results.get("estimate.created")?.data).toMatchObject({
      type: "points",
      points: [{ value: "1" }, { value: "2" }, { value: "3" }],
    });
    expect(results.get("project.features_updated")?.data).toMatchObject({
      id: projectId,
      features: { cycles: true, timeTracking: true },
    });
    // Moderation's per-task hints name no comment and are not delivered.
    const hints = (await deliveryRows(webhook.id)).length;
    await publishEvent("comment.updated", {
      taskId: payloads["comment.created"]?.taskId,
      projectId,
      userId: s.mia.id,
      changes: ["visibility"],
      visibility: "internal",
      origin: "app",
    });
    await settleWebhookEnqueues();
    expect((await deliveryRows(webhook.id)).length).toBe(hints);

    // The relation removed with its task is left to task.deleted.
    const before = (await deliveryRows(webhook.id)).length;
    await publishEvent("task-relation.deleted", {
      ...payloads["task-relation.deleted"],
      origin: "task_deleted",
    });
    await settleWebhookEnqueues();
    expect((await deliveryRows(webhook.id)).length).toBe(before);
  });

  it("publishes project events from the real project routes", async () => {
    const { s, webhook } = await scene();
    const created = await s.ok<{ id: string }>(s.ada, "POST", "/project", {
      name: "Mobile",
      workspaceId: s.workspaceId,
      icon: "Layout",
      slug: "mob",
    });
    await settleWebhookEnqueues();
    await s.ok(s.ada, "PUT", `/project/${created.id}`, {
      name: "Mobile app",
      icon: "Layout",
      slug: "mob",
      description: "",
      isPublic: false,
    });
    await settleWebhookEnqueues();
    await s.ok(s.ada, "DELETE", `/project/${created.id}`);
    await settleWebhookEnqueues();

    const bodies = (await deliveryRows(webhook.id))
      .map((row) => JSON.parse(row.body) as Body)
      .filter((body) => body.event.startsWith("project."));
    expect(bodies.map((body) => body.event)).toEqual([
      "project.created",
      "project.updated",
      "project.deleted",
    ]);
    expect(bodies[0]).toMatchObject({
      actor: { id: s.ada.id, name: "Ada" },
      data: { id: created.id, name: "Mobile", slug: "mob" },
    });
    expect(bodies[1]?.changes).toEqual({ name: null });
    expect(bodies[2]).toMatchObject({
      project: { id: created.id, name: "Mobile app", slug: "mob" },
      data: { id: created.id, name: "Mobile app", slug: "mob" },
    });
  });
});
