import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  assignTask,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { type QueryResult, queryScene } from "./helpers/task-query";

// A member's profile: the header route, their activity and the stats the
// profile asks the task query engine for (the same requests the web sends).

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

type ActivityPage = {
  items: Array<{ id: string; userId: string; task: { id: string } }>;
  nextCursor: string | null;
};

const OPEN = {
  key: "group",
  operator: "in",
  values: ["backlog", "unstarted", "started"],
};

function profileRequests(userId: string) {
  const assigned = { key: "assignee", operator: "in", values: [userId] };
  const and = (...children: unknown[]) => ({ op: "and", children });
  return {
    byGroup: {
      filters: and(assigned),
      display: { groupBy: "group" },
    },
    byPriority: {
      filters: and(assigned, OPEN),
      display: { groupBy: "priority", showEmptyGroups: true },
    },
    overdue: {
      filters: and(assigned, OPEN, {
        key: "dueDate",
        operator: "in",
        values: ["past"],
      }),
    },
    completed30: {
      filters: and(
        assigned,
        { key: "group", operator: "in", values: ["completed"] },
        {
          key: "completedAt",
          operator: "withinLast",
          amount: 30,
          unit: "days",
        },
      ),
    },
    created30: {
      filters: and(
        { key: "createdBy", operator: "in", values: [userId] },
        { key: "createdAt", operator: "withinLast", amount: 30, unit: "days" },
      ),
    },
  };
}

async function scene() {
  const s = await queryScene();
  const { app, workspaceId, owner, ben, cara, viewer, project } = s;
  await db.insert(schema.columnTable).values({
    projectId: project.id,
    name: "Triage",
    slug: "triage",
    position: 99,
    group: "triage",
  });

  // Ben is also in a workspace Olivia cannot see.
  const elsewhere = await createWorkspaceMember({ userName: "Elsa" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: elsewhere.workspace.id,
    userId: ben.id,
    role: "member",
    joinedAt: new Date(),
  });
  const { project: hiddenProject } = await createProjectFixture({
    workspaceId: elsewhere.workspace.id,
    slug: "hid",
  });

  const as = (user: typeof owner) => (path: string) => {
    mockAuthenticatedSession(user);
    return app.request(`/api${path}`);
  };
  const counts = async (body: Record<string, unknown>, user = owner) =>
    s.query({ mode: "counts", context: { timeZone: "UTC" }, ...body }, user);

  return {
    ...s,
    workspaceId,
    ben,
    cara,
    viewer,
    elsewhere,
    hiddenProject,
    as,
    counts,
  };
}

describe("API integration: member profiles", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns a member's header to members only, and 404 for non-members", async () => {
    const { as, workspaceId, ben, viewer, elsewhere } = await scene();

    const response = await as(viewer)(
      `/workspace/${workspaceId}/members/${ben.id}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: ben.id,
      name: "Ben",
      email: ben.email,
      role: "member",
    });
    expect(typeof body.joinedAt).toBe("string");

    // An outsider is refused; someone who is not a member is not found.
    const outsider = await as(elsewhere.user)(
      `/workspace/${workspaceId}/members/${ben.id}`,
    );
    expect(outsider.status).toBe(403);
    const stranger = await as(viewer)(
      `/workspace/${workspaceId}/members/${elsewhere.user.id}`,
    );
    expect(stranger.status).toBe(404);
  });

  it("computes the profile stats from what the viewer can see", async () => {
    const s = await scene();
    const { ben, createTask, hiddenProject, workspaceId, counts } = s;

    // Assigned to Ben and visible: open late, open, done lately, done long ago.
    await createTask({
      assignees: [ben.id],
      status: "to-do",
      dueDate: daysAgo(3),
      priority: "high",
    });
    await createTask({
      assignees: [ben.id],
      status: "in-progress",
      priority: "high",
    });
    await createTask({
      assignees: [ben.id],
      status: "done",
      completedAt: daysAgo(2),
    });
    await createTask({
      assignees: [ben.id],
      status: "done",
      completedAt: daysAgo(40),
    });
    // Assigned to Ben but not visible: in intake, archived, trashed.
    await createTask({ assignees: [ben.id], status: "triage" });
    await createTask({ assignees: [ben.id], archivedAt: daysAgo(1) });
    await createTask({
      assignees: [ben.id],
      deletedAt: daysAgo(1),
      dueDate: daysAgo(3),
    });
    // Created by Ben: lately, long ago, lately but trashed.
    await createTask({ createdBy: ben.id, createdAt: daysAgo(5) });
    await createTask({ createdBy: ben.id, createdAt: daysAgo(60) });
    await createTask({
      createdBy: ben.id,
      createdAt: daysAgo(5),
      deletedAt: daysAgo(1),
    });
    // Another workspace's task, and Ben's private draft here.
    const [hidden] = await db
      .insert(schema.taskTable)
      .values({
        projectId: hiddenProject.id,
        title: "Hidden",
        number: 1,
        status: "to-do",
        createdBy: ben.id,
        dueDate: daysAgo(3),
      })
      .returning();
    if (!hidden) throw new Error("no hidden task");
    await assignTask(hidden.id, [ben.id]);
    await db.insert(schema.taskDraftTable).values({
      workspaceId,
      createdBy: ben.id,
      title: "Private draft",
      assigneeIds: [ben.id],
    });

    const requests = profileRequests(ben.id);
    const byGroup: QueryResult = await counts(requests.byGroup);
    const groups = Object.fromEntries(
      byGroup.groups.map((group) => [group.key, group.count]),
    );
    expect(byGroup.totalCount).toBe(4);
    expect(groups).toEqual({ unstarted: 1, started: 1, completed: 2 });

    const byPriority = await counts(requests.byPriority);
    expect(byPriority.groups.find((group) => group.key === "high")?.count).toBe(
      2,
    );
    expect((await counts(requests.overdue)).totalCount).toBe(1);
    expect((await counts(requests.completed30)).totalCount).toBe(1);
    expect((await counts(requests.created30)).totalCount).toBe(1);

    // A viewer (task:read only) gets the same numbers.
    expect((await counts(requests.overdue, s.viewer)).totalCount).toBe(1);
  });

  it("lists a member's activity only on tasks the viewer can see", async () => {
    const s = await scene();
    const { ben, cara, viewer, createTask, hiddenProject, workspaceId, as } = s;
    const visible = await createTask();
    const triage = await createTask({ status: "triage" });
    const trashed = await createTask({ deletedAt: daysAgo(1) });
    const [hidden] = await db
      .insert(schema.taskTable)
      .values({
        projectId: hiddenProject.id,
        title: "Hidden",
        number: 1,
        status: "to-do",
      })
      .returning();
    if (!hidden) throw new Error("no hidden task");

    const rows = await db
      .insert(schema.activityTable)
      .values([
        { taskId: visible.id, userId: ben.id, type: "status_changed" },
        { taskId: visible.id, userId: cara.id, type: "status_changed" },
        { taskId: triage.id, userId: ben.id, type: "status_changed" },
        { taskId: trashed.id, userId: ben.id, type: "status_changed" },
        { taskId: hidden.id, userId: ben.id, type: "status_changed" },
      ])
      .returning();

    const response = await as(viewer)(
      `/activity/member/${ben.id}?workspaceId=${workspaceId}`,
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as ActivityPage;
    expect(page.items.map((item) => item.id)).toEqual([rows[0]?.id]);
    expect(page.items[0]?.task.id).toBe(visible.id);
  });

  it("refuses outsiders and people outside the workspace", async () => {
    const { as, workspaceId, ben, viewer, elsewhere } = await scene();

    const outsider = await as(elsewhere.user)(
      `/activity/member/${ben.id}?workspaceId=${workspaceId}`,
    );
    expect(outsider.status).toBe(403);

    const stranger = await as(viewer)(
      `/activity/member/${elsewhere.user.id}?workspaceId=${workspaceId}`,
    );
    expect(stranger.status).toBe(404);
  });
});
