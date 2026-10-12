import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  assigneeContext,
  assigneeRows,
  storedTask,
  type TaskJson,
} from "./helpers/assignees";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// Record events instead of delivering them, so no subscriber writes after
// the next TRUNCATE.
const { published } = vi.hoisted(() => ({
  published: [] as Array<{ event: string; data: Record<string, unknown> }>,
}));
vi.mock("../../apps/api/src/events", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/events")>();
  return {
    ...actual,
    publishEvent: async (event: string, data: Record<string, unknown>) => {
      published.push({ event, data });
    },
  };
});

type Task = Awaited<
  ReturnType<Awaited<ReturnType<typeof assigneeContext>>["createTask"]>
>;

/** The full-replace body a client echoes back, with overrides. */
function echo(task: Task, extra: Record<string, unknown> = {}) {
  return {
    title: `${task.title} edited`,
    description: "",
    priority: "high",
    status: task.status,
    projectId: task.projectId,
    position: task.position ?? 0,
    ...extra,
  };
}

beforeEach(async () => {
  await resetTestDatabase();
  published.length = 0;
});

describe("the full task update", () => {
  it("keeps every assignee when the first one is echoed, without task:assign", async () => {
    const ctx = await assigneeContext("member");
    const ana = await ctx.person("Ana");
    const task = await ctx.createTask([ana.id, ctx.user.id]);

    const response = await ctx.call(
      "PUT",
      `/task/${task.id}`,
      echo(task, { userId: ana.id }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      title: `${task.title} edited`,
      userId: ana.id,
      assigneeIds: [ana.id, ctx.user.id],
    });
    expect(await assigneeRows(task.id)).toHaveLength(2);
    expect(published.filter((e) => e.event.startsWith("task.assign"))).toEqual(
      [],
    );
  });

  it("needs task:assign to replace with another single userId", async () => {
    const ctx = await assigneeContext("member");
    const ana = await ctx.person("Ana");
    const task = await ctx.createTask([ana.id, ctx.user.id]);

    const refused = await ctx.call(
      "PUT",
      `/task/${task.id}`,
      echo(task, { userId: ctx.user.id }),
    );
    expect(refused.status).toBe(403);
    expect(await assigneeRows(task.id)).toHaveLength(2);
    expect((await storedTask(task.id)).title).toBe(task.title);

    const admin = await assigneeContext("admin");
    const ben = await admin.person("Ben");
    const cid = await admin.person("Cid");
    const other = await admin.createTask([ben.id, cid.id]);
    const replaced = await admin.call(
      "PUT",
      `/task/${other.id}`,
      echo(other, { userId: cid.id }),
    );
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({
      userId: cid.id,
      assigneeIds: [cid.id],
    });
  });

  it("clears when userId is omitted, which needs task:assign only if someone was assigned", async () => {
    const ctx = await assigneeContext("member");
    const ana = await ctx.person("Ana");
    const assigned = await ctx.createTask([ana.id]);
    const unassigned = await ctx.createTask();

    const refused = await ctx.call(
      "PUT",
      `/task/${assigned.id}`,
      echo(assigned),
    );
    expect(refused.status).toBe(403);
    expect(await assigneeRows(assigned.id)).toHaveLength(1);

    // Echoing an unassigned task (userId "" or omitted) changes nobody.
    for (const extra of [{}, { userId: "" }]) {
      const response = await ctx.call(
        "PUT",
        `/task/${unassigned.id}`,
        echo(unassigned, extra),
      );
      expect(response.status, await response.clone().text()).toBe(200);
    }
  });

  it("compares assigneeIds as a set and applies real changes", async () => {
    const ctx = await assigneeContext("member");
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const task = await ctx.createTask([ana.id, ben.id]);

    const reordered = await ctx.call(
      "PUT",
      `/task/${task.id}`,
      echo(task, { assigneeIds: [ben.id, ana.id], userId: "ignored" }),
    );
    expect(reordered.status).toBe(200);
    expect(await reordered.json()).toMatchObject({
      assigneeIds: [ana.id, ben.id],
    });

    const changed = await ctx.call(
      "PUT",
      `/task/${task.id}`,
      echo(task, { assigneeIds: [ana.id] }),
    );
    expect(changed.status).toBe(403);

    const admin = await assigneeContext("admin");
    const cid = await admin.person("Cid");
    const dee = await admin.person("Dee");
    const other = await admin.createTask([cid.id]);
    const applied = await admin.call(
      "PUT",
      `/task/${other.id}`,
      echo(other, { assigneeIds: [dee.id, cid.id], status: "in-progress" }),
    );
    expect(applied.status, await applied.clone().text()).toBe(200);
    expect(await applied.json()).toMatchObject({
      status: "in-progress",
      userId: cid.id,
      assigneeIds: [cid.id, dee.id],
    });
    const statusEvent = published.find(
      (e) => e.event === "task.status_changed",
    );
    expect(statusEvent?.data.assigneeId).toBe(cid.id);
    expect(
      published
        .filter((e) => e.event === "task.assignee_changed")
        .map((e) => e.data.newAssigneeId),
    ).toEqual([dee.id]);
  });
});

describe("who may change assignees", () => {
  it("lets admins and owners set and patch, not members or viewers", async () => {
    for (const [role, status] of [
      ["viewer", 403],
      ["member", 403],
      ["admin", 200],
      ["owner", 200],
    ] as const) {
      const ctx = await assigneeContext(role);
      const ana = await ctx.person("Ana");
      const task = await ctx.createTask();

      const set = await ctx.call("PUT", `/task/assignees/${task.id}`, {
        assigneeIds: [ana.id],
      });
      expect(set.status, `${role} PUT`).toBe(status);
      const patch = await ctx.call("PATCH", `/task/assignees/${task.id}`, {
        remove: [ana.id],
      });
      expect(patch.status, `${role} PATCH`).toBe(status);
    }
  });

  it("hides another workspace's tasks", async () => {
    const ctx = await assigneeContext();
    const task = await ctx.createTask();
    const stranger = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(stranger.user);

    for (const method of ["PUT", "PATCH"]) {
      const response = await ctx.call(method, `/task/assignees/${task.id}`, {
        assigneeIds: [stranger.user.id],
        add: [stranger.user.id],
      });
      expect(response.status).toBe(403);
    }
    expect(await assigneeRows(task.id)).toEqual([]);
  });

  it("lets a member pick assignees when creating a task", async () => {
    const ctx = await assigneeContext("member");
    const ana = await ctx.person("Ana");
    const response = await ctx.call("POST", `/task/${ctx.project.id}`, {
      title: "Mine",
      description: "",
      priority: "low",
      status: "to-do",
      assigneeIds: [ana.id, ctx.user.id],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      assigneeIds: [ana.id, ctx.user.id],
    });
  });
});

describe("bulk assignee operations", () => {
  async function bulk(
    ctx: Awaited<ReturnType<typeof assigneeContext>>,
    taskIds: string[],
    operation: string,
    value: string | null,
  ) {
    return ctx.call("PATCH", "/task/bulk", { taskIds, operation, value });
  }

  it("adds, removes and replaces across tasks, counting real changes", async () => {
    const ctx = await assigneeContext("admin");
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const t1 = await ctx.createTask([ana.id]);
    const t2 = await ctx.createTask([ben.id]);
    const t3 = await ctx.createTask();
    const ids = [t1.id, t2.id, t3.id];

    const added = await bulk(ctx, ids, "addAssignee", ana.id);
    expect(await added.json()).toEqual({ success: true, updatedCount: 2 });
    expect((await assigneeRows(t2.id)).map((r) => r.userId)).toEqual([
      ben.id,
      ana.id,
    ]);
    expect((await storedTask(t3.id)).userId).toBe(ana.id);

    const removed = await bulk(ctx, ids, "removeAssignee", ana.id);
    expect(await removed.json()).toEqual({ success: true, updatedCount: 3 });
    expect((await storedTask(t1.id)).userId).toBeNull();
    expect((await storedTask(t2.id)).userId).toBe(ben.id);

    const replaced = await bulk(ctx, ids, "updateAssignee", ana.id);
    expect(await replaced.json()).toEqual({ success: true, updatedCount: 3 });
    for (const id of ids) {
      expect(await assigneeRows(id)).toEqual([
        expect.objectContaining({ userId: ana.id }),
      ]);
    }

    const cleared = await bulk(ctx, ids, "updateAssignee", null);
    expect(await cleared.json()).toEqual({ success: true, updatedCount: 3 });
    for (const id of ids) expect(await assigneeRows(id)).toEqual([]);

    const required = await bulk(ctx, ids, "addAssignee", null);
    expect(required.status).toBe(400);
  });

  it("publishes per task and per user, removals first", async () => {
    const ctx = await assigneeContext("admin");
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const t1 = await ctx.createTask([ana.id]);
    const t2 = await ctx.createTask([ben.id]);

    await bulk(ctx, [t1.id, t2.id], "updateAssignee", ben.id);
    expect(
      published.flatMap(({ event, data }) =>
        event === "task.unassigned"
          ? [["-", data.taskId, data.oldAssigneeId]]
          : event === "task.assignee_changed"
            ? [["+", data.taskId, data.newAssigneeId]]
            : [],
      ),
    ).toEqual([
      ["-", t1.id, ana.id],
      ["+", t1.id, ben.id],
    ]);
    // One relation refresh per affected project.
    expect(
      published.filter((e) => e.event === "task-relation.refresh"),
    ).toHaveLength(1);
  });

  it("needs task:assign and a workspace member", async () => {
    const member = await assigneeContext("member");
    const task = await member.createTask();
    for (const operation of [
      "addAssignee",
      "removeAssignee",
      "updateAssignee",
    ]) {
      const response = await bulk(member, [task.id], operation, member.user.id);
      expect(response.status, operation).toBe(403);
    }

    const admin = await assigneeContext("admin");
    const own = await admin.createTask();
    const stranger = await createWorkspaceMember();
    const foreign = await bulk(
      admin,
      [own.id],
      "addAssignee",
      stranger.user.id,
    );
    expect(foreign.status).toBe(403);
    expect(await assigneeRows(own.id)).toEqual([]);
  });

  it("changes no task when one would pass 20 assignees", async () => {
    const ctx = await assigneeContext("admin");
    const people = [];
    for (let i = 0; i < 21; i++) people.push(await ctx.person(`P${i}`));
    const full = await ctx.createTask(people.slice(0, 20).map((p) => p.id));
    const empty = await ctx.createTask();
    const extra = people[20]?.id ?? "";

    const response = await bulk(ctx, [empty.id, full.id], "addAssignee", extra);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("A task can have at most 20 assignees");
    expect(await assigneeRows(empty.id)).toEqual([]);
    expect(await assigneeRows(full.id)).toHaveLength(20);
    expect(published).toEqual([]);
  });
});

describe("task lifecycle", () => {
  it("keeps assignees when a task moves and drops them with the task", async () => {
    const ctx = await assigneeContext("owner");
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const task = await ctx.createTask([ana.id, ben.id]);
    const { project: other } = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      slug: "oth",
    });

    const moved = await ctx.call("PUT", `/task/move/${task.id}`, {
      destinationProjectId: other.id,
    });
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect(((await moved.json()) as { task: TaskJson }).task).toMatchObject({
      userId: ana.id,
      assigneeIds: [ana.id, ben.id],
    });
    expect(await assigneeRows(task.id)).toHaveLength(2);

    const deleted = await ctx.call("DELETE", `/task/${task.id}`);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      assigneeIds: [ana.id, ben.id],
    });
    // Deleting trashes the task (C7); the permanent delete drops them.
    const purged = await ctx.call("DELETE", `/trash/task/${task.id}`);
    expect(purged.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.taskAssigneeTable)
        .where(eq(schema.taskAssigneeTable.taskId, task.id)),
    ).toEqual([]);
  });

  it("lets archived tasks change assignees and returns them from every task route", async () => {
    const ctx = await assigneeContext("owner");
    const ana = await ctx.person("Ana");
    const task = await ctx.createTask([], { archivedAt: new Date() });

    const set = await ctx.call("PUT", `/task/assignees/${task.id}`, {
      assigneeIds: [ana.id],
    });
    expect(set.status).toBe(200);

    for (const [path, body] of [
      [`/task/status/${task.id}`, { status: "to-do" }],
      [`/task/priority/${task.id}`, { priority: "urgent" }],
      [`/task/title/${task.id}`, { title: "Renamed" }],
      [`/task/description/${task.id}`, { description: "Body" }],
      [`/task/due-date/${task.id}`, {}],
    ] as const) {
      const response = await ctx.call("PUT", path, body);
      expect(response.status, path).toBe(200);
      expect(await response.json(), path).toMatchObject({
        assigneeIds: [ana.id],
      });
    }
  });

  it("exports the ordered list and imports it back", async () => {
    const ctx = await assigneeContext("owner");
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    await ctx.createTask([ben.id, ana.id]);

    // Seeded tasks bypass the project's number counter.
    await db
      .update(schema.projectTable)
      .set({ lastTaskNumber: 100 })
      .where(eq(schema.projectTable.id, ctx.project.id));

    const exported = (await (
      await ctx.call("GET", `/task/export/${ctx.project.id}`)
    ).json()) as {
      tasks: Array<{ userId: string | null; assigneeIds: string[] }>;
    };
    expect(exported.tasks[0]).toMatchObject({
      userId: ben.id,
      assigneeIds: [ben.id, ana.id],
    });

    const imported = await ctx.call("POST", `/task/import/${ctx.project.id}`, {
      tasks: [
        { title: "Both", status: "to-do", assigneeIds: [ana.id, ben.id] },
        { title: "Legacy", status: "to-do", userId: ` ${ben.id} ` },
        {
          title: "Foreign",
          status: "to-do",
          assigneeIds: [ana.id, "user-nobody"],
        },
      ],
    });
    expect(imported.status).toBe(200);
    const result = (await imported.json()) as {
      results: {
        successful: number;
        tasks: Array<{
          success: boolean;
          error?: string;
          task: { id?: string; assigneeIds?: string[] };
        }>;
      };
    };
    expect(result.results.successful).toBe(2);
    const [both, legacy, foreign] = result.results.tasks;
    expect(both?.task.assigneeIds).toEqual([ana.id, ben.id]);
    expect(legacy?.task.assigneeIds).toEqual([ben.id]);
    expect(foreign).toMatchObject({
      success: false,
      error: "Assignee is not a member of this workspace",
    });
    expect(await assigneeRows(both?.task.id ?? "")).toEqual([
      { userId: ana.id, position: 0 },
      { userId: ben.id, position: 1 },
    ]);
  });
});
