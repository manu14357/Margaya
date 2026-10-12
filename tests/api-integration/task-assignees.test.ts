import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  assigneeContext,
  assigneeRows,
  removeFromWorkspace,
  storedTask,
  type TaskJson,
} from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import { setProjectPublic } from "./helpers/publication";

// Record events instead of delivering them: these tests check what is
// published, and no subscriber may write after the next TRUNCATE.
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

const OLD = new Date("2020-01-01T00:00:00.000Z");

/** Per-user assignee events, in publish order: ["-", id] or ["+", id]. */
function assigneeEvents() {
  return published.flatMap(({ event, data }) => {
    if (event === "task.unassigned") return [["-", data.oldAssigneeId]];
    if (event === "task.assignee_changed") return [["+", data.newAssigneeId]];
    return [];
  });
}

async function age(taskId: string) {
  await db
    .update(schema.taskTable)
    .set({ updatedAt: OLD })
    .where(eq(schema.taskTable.id, taskId));
}

function createBody(extra: Record<string, unknown>) {
  return {
    title: "New task",
    description: "",
    priority: "low",
    status: "to-do",
    ...extra,
  };
}

beforeEach(async () => {
  await resetTestDatabase();
  published.length = 0;
});

describe("creating tasks with assignees", () => {
  it("stores an ordered list and mirrors the first assignee", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");

    const response = await ctx.call(
      "POST",
      `/task/${ctx.project.id}`,
      createBody({ assigneeIds: [ana.id, ben.id] }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const task = (await response.json()) as TaskJson & {
      assigneeName: string;
    };
    expect(task).toMatchObject({
      userId: ana.id,
      assigneeIds: [ana.id, ben.id],
      assigneeName: "Ana",
    });
    expect(await assigneeRows(task.id)).toEqual([
      { userId: ana.id, position: 0 },
      { userId: ben.id, position: 1 },
    ]);
    expect((await storedTask(task.id)).userId).toBe(ana.id);

    const created = published.find((e) => e.event === "task.created");
    expect(created?.data).toMatchObject({
      userId: ana.id,
      assigneeIds: [ana.id, ben.id],
      currentUserId: ctx.user.id,
    });
    // Creating is not an assignee change.
    expect(assigneeEvents()).toEqual([]);
  });

  it("keeps the single userId working and lets assigneeIds win", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");

    const single = (await (
      await ctx.call(
        "POST",
        `/task/${ctx.project.id}`,
        createBody({ userId: ` ${ana.id} ` }),
      )
    ).json()) as TaskJson;
    expect(single).toMatchObject({ userId: ana.id, assigneeIds: [ana.id] });
    expect(await assigneeRows(single.id)).toEqual([
      { userId: ana.id, position: 0 },
    ]);

    const both = (await (
      await ctx.call(
        "POST",
        `/task/${ctx.project.id}`,
        createBody({ userId: ana.id, assigneeIds: [ben.id] }),
      )
    ).json()) as TaskJson;
    expect(both).toMatchObject({ userId: ben.id, assigneeIds: [ben.id] });
  });

  it("normalizes duplicates and blanks, and [] means unassigned", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");

    const normalized = (await (
      await ctx.call(
        "POST",
        `/task/${ctx.project.id}`,
        createBody({ assigneeIds: [` ${ben.id}`, ana.id, ben.id, " "] }),
      )
    ).json()) as TaskJson;
    expect(normalized.assigneeIds).toEqual([ben.id, ana.id]);

    const empty = (await (
      await ctx.call(
        "POST",
        `/task/${ctx.project.id}`,
        createBody({ assigneeIds: [], userId: ana.id }),
      )
    ).json()) as TaskJson;
    expect(empty).toMatchObject({ userId: null, assigneeIds: [] });
    expect(await assigneeRows(empty.id)).toEqual([]);
  });

  it("rejects more than 20 people and a non-member, creating nothing", async () => {
    const ctx = await assigneeContext();

    const tooMany = await ctx.call(
      "POST",
      `/task/${ctx.project.id}`,
      createBody({
        assigneeIds: Array.from({ length: 21 }, (_, i) => `user-${i}`),
      }),
    );
    expect(tooMany.status).toBe(400);
    expect(await tooMany.text()).toContain(
      "A task can have at most 20 assignees",
    );

    const [stranger] = await db
      .insert(schema.userTable)
      .values({
        id: "user-stranger",
        email: "stranger@example.com",
        emailVerified: true,
        name: "Stranger",
      })
      .returning();
    const foreign = await ctx.call(
      "POST",
      `/task/${ctx.project.id}`,
      createBody({ assigneeIds: [ctx.user.id, stranger?.id] }),
    );
    expect(foreign.status).toBe(403);
    expect(await foreign.text()).toBe(
      "Assignee is not a member of this workspace",
    );
    expect(await db.select().from(schema.taskTable)).toEqual([]);
  });
});

describe("reading assignees", () => {
  it("returns ids and people (never emails) on task detail", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const task = await ctx.createTask([ben.id, ana.id]);

    const detail = (await (
      await ctx.call("GET", `/task/${task.id}`)
    ).json()) as Record<string, unknown>;
    expect(detail).toMatchObject({
      userId: ben.id,
      assigneeId: ben.id,
      assigneeName: "Ben",
      assigneeIds: [ben.id, ana.id],
      assignees: [
        { id: ben.id, name: "Ben", image: ben.image },
        { id: ana.id, name: "Ana", image: ana.image },
      ],
    });
    expect(JSON.stringify(detail.assignees)).not.toContain("@example.com");
  });

  it("embeds complete assignees in every board page and related page", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const both = await ctx.createTask([ana.id, ben.id]);
    const nobody = await ctx.createTask();

    type Board = {
      data: {
        columns: Array<{
          tasks: Array<
            TaskJson & { assignees: Array<{ id: string; name: string }> }
          >;
        }>;
      };
    };
    for (const query of ["", "?relatedPage=2", "?limit=1&page=1"]) {
      const board = (await (
        await ctx.call("GET", `/task/tasks/${ctx.project.id}${query}`)
      ).json()) as Board;
      const tasks = board.data.columns.flatMap((column) => column.tasks);
      const listed = tasks.find((task) => task.id === both.id);
      expect(listed).toMatchObject({
        userId: ana.id,
        assigneeName: "Ana",
        assigneeIds: [ana.id, ben.id],
        assignees: [
          { id: ana.id, name: "Ana" },
          { id: ben.id, name: "Ben" },
        ],
      });
      const empty = tasks.find((task) => task.id === nobody.id);
      if (empty)
        expect(empty).toMatchObject({ assigneeIds: [], assignees: [] });
    }
  });

  it("shows assignees on the public board", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const task = await ctx.createTask([ana.id]);
    await setProjectPublic(ctx.project.id, true);

    const response = await ctx.app.request(
      `/api/public-project/${ctx.project.id}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      columns: Array<{ tasks: Array<Record<string, unknown>> }>;
    };
    const listed = body.columns
      .flatMap((column) => column.tasks)
      .find((candidate) => candidate.id === task.id);
    expect(listed).toMatchObject({
      assigneeIds: [ana.id],
      assignees: [{ id: ana.id, name: "Ana", image: ana.image }],
    });
    expect(JSON.stringify(body)).not.toContain(ana.email);
  });

  it("filters the board by any assignee, not only the first", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const cid = await ctx.person("Cid");
    const shared = await ctx.createTask([ana.id, ben.id]);
    await ctx.createTask([cid.id]);

    const ids = async (assigneeId: string) => {
      const board = (await (
        await ctx.call(
          "GET",
          `/task/tasks/${ctx.project.id}?assigneeId=${assigneeId}`,
        )
      ).json()) as { data: { columns: Array<{ tasks: TaskJson[] }> } };
      return board.data.columns.flatMap((c) => c.tasks).map((t) => t.id);
    };
    expect(await ids(ben.id)).toEqual([shared.id]);
    expect(await ids(ana.id)).toEqual([shared.id]);
    expect(await ids(ctx.user.id)).toEqual([]);
  });
});

describe("setting the assignee list", () => {
  it("removes, then adds, keeping the order of people who stay", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const cid = await ctx.person("Cid");
    const task = await ctx.createTask([ana.id, ben.id]);
    await age(task.id);

    const response = await ctx.call("PUT", `/task/assignees/${task.id}`, {
      assigneeIds: [cid.id, ben.id],
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      id: task.id,
      userId: ben.id,
      assigneeIds: [ben.id, cid.id],
    });
    expect(await assigneeRows(task.id)).toEqual([
      { userId: ben.id, position: 1 },
      { userId: cid.id, position: 2 },
    ]);
    const stored = await storedTask(task.id);
    expect(stored.userId).toBe(ben.id);
    expect(stored.updatedAt.getTime()).toBeGreaterThan(OLD.getTime());

    expect(assigneeEvents()).toEqual([
      ["-", ana.id],
      ["+", cid.id],
    ]);
    const removed = published.find((e) => e.event === "task.unassigned");
    expect(removed?.data).toMatchObject({
      taskId: task.id,
      projectId: ctx.project.id,
      userId: ctx.user.id,
      type: "unassigned",
      oldAssigneeId: ana.id,
      oldAssignee: "Ana",
      assigneeIds: [ben.id, cid.id],
    });
    const added = published.find((e) => e.event === "task.assignee_changed");
    expect(added?.data).toMatchObject({
      type: "assignee_changed",
      oldAssignee: ana.id,
      newAssignee: "Cid",
      newAssigneeId: cid.id,
      assigneeIds: [ben.id, cid.id],
    });
    expect(
      published.filter((e) => e.event === "task-relation.refresh"),
    ).toHaveLength(1);
  });

  it("changes nothing for the same people in another order", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const task = await ctx.createTask([ana.id, ben.id]);
    await age(task.id);

    const response = await ctx.call("PUT", `/task/assignees/${task.id}`, {
      assigneeIds: [ben.id, ana.id],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      assigneeIds: [ana.id, ben.id],
    });
    expect(published).toEqual([]);
    expect((await storedTask(task.id)).updatedAt).toEqual(OLD);
  });

  it("clears everyone with an empty list", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const task = await ctx.createTask([ana.id, ben.id]);

    const response = await ctx.call("PUT", `/task/assignees/${task.id}`, {
      assigneeIds: [],
    });
    expect(await response.json()).toMatchObject({
      userId: null,
      assigneeIds: [],
    });
    expect(await assigneeRows(task.id)).toEqual([]);
    expect((await storedTask(task.id)).userId).toBeNull();
    expect(assigneeEvents()).toEqual([
      ["-", ana.id],
      ["-", ben.id],
    ]);
  });

  it("keeps a former member who stays, but never adds one", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const gone = await ctx.person("Gone");
    const task = await ctx.createTask([gone.id]);
    await removeFromWorkspace(gone.id, ctx.workspace.id);

    const kept = await ctx.call("PUT", `/task/assignees/${task.id}`, {
      assigneeIds: [gone.id, ana.id],
    });
    expect(kept.status, await kept.clone().text()).toBe(200);
    expect(await assigneeRows(task.id)).toEqual([
      { userId: gone.id, position: 0 },
      { userId: ana.id, position: 1 },
    ]);

    const other = await ctx.createTask();
    const refused = await ctx.call("PUT", `/task/assignees/${other.id}`, {
      assigneeIds: [gone.id],
    });
    expect(refused.status).toBe(403);
    expect(await assigneeRows(other.id)).toEqual([]);
  });
});

describe("adding and removing assignees", () => {
  it("treats adding someone already assigned as a no-op", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const task = await ctx.createTask([ana.id]);
    await age(task.id);

    const response = await ctx.call("PATCH", `/task/assignees/${task.id}`, {
      add: [ana.id],
      remove: [ctx.user.id],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ assigneeIds: [ana.id] });
    expect(published).toEqual([]);
    expect((await storedTask(task.id)).updatedAt).toEqual(OLD);
  });

  it("promotes the next assignee when the first is removed", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const cid = await ctx.person("Cid");
    const task = await ctx.createTask([ana.id, ben.id]);

    const response = await ctx.call("PATCH", `/task/assignees/${task.id}`, {
      remove: [ana.id],
      add: [cid.id],
    });
    expect(await response.json()).toMatchObject({
      userId: ben.id,
      assigneeIds: [ben.id, cid.id],
    });
    expect((await storedTask(task.id)).userId).toBe(ben.id);
    expect(assigneeEvents()).toEqual([
      ["-", ana.id],
      ["+", cid.id],
    ]);
  });

  it("rejects an empty request and a user both added and removed", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const task = await ctx.createTask([ana.id]);

    const empty = await ctx.call("PATCH", `/task/assignees/${task.id}`, {});
    expect(empty.status).toBe(400);
    expect(await empty.text()).toBe("Provide users to add or remove");

    const both = await ctx.call("PATCH", `/task/assignees/${task.id}`, {
      add: [ana.id],
      remove: [ana.id],
    });
    expect(both.status).toBe(400);
    expect(await both.text()).toBe(
      "A user can't be added and removed in the same request",
    );
    expect(await assigneeRows(task.id)).toHaveLength(1);
  });

  it("refuses the 21st assignee and changes nothing", async () => {
    const ctx = await assigneeContext();
    const people = [];
    for (let i = 0; i < 21; i++) people.push(await ctx.person(`P${i}`));
    const task = await ctx.createTask(people.slice(0, 20).map((p) => p.id));

    const response = await ctx.call("PATCH", `/task/assignees/${task.id}`, {
      add: [people[20]?.id],
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("A task can have at most 20 assignees");
    expect(await assigneeRows(task.id)).toHaveLength(20);

    // Swapping one person keeps the count at 20 and is fine.
    const swap = await ctx.call("PATCH", `/task/assignees/${task.id}`, {
      remove: [people[0]?.id],
      add: [people[20]?.id],
    });
    expect(swap.status).toBe(200);
    expect(await assigneeRows(task.id)).toHaveLength(20);
  });

  it("removes a former member, but refuses to add one back", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const gone = await ctx.person("Gone");
    const task = await ctx.createTask([gone.id, ana.id]);
    await removeFromWorkspace(gone.id, ctx.workspace.id);

    const removed = await ctx.call("PATCH", `/task/assignees/${task.id}`, {
      remove: [gone.id],
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({
      userId: ana.id,
      assigneeIds: [ana.id],
    });

    const readded = await ctx.call("PATCH", `/task/assignees/${task.id}`, {
      add: [gone.id],
    });
    expect(readded.status).toBe(403);
    expect(await readded.text()).toBe(
      "Assignee is not a member of this workspace",
    );
  });
});

describe("the legacy single-assignee route", () => {
  it("replaces everyone with one person, or clears", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const ben = await ctx.person("Ben");
    const xen = await ctx.person("Xen");
    const task = await ctx.createTask([ana.id, ben.id]);

    const replaced = await ctx.call("PUT", `/task/assignee/${task.id}`, {
      userId: xen.id,
    });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({
      userId: xen.id,
      assigneeIds: [xen.id],
    });
    expect(assigneeEvents()).toEqual([
      ["-", ana.id],
      ["-", ben.id],
      ["+", xen.id],
    ]);

    const cleared = await ctx.call("PUT", `/task/assignee/${task.id}`, {
      userId: null,
    });
    expect(await cleared.json()).toMatchObject({
      userId: null,
      assigneeIds: [],
    });
    expect(await assigneeRows(task.id)).toEqual([]);
  });

  it("does nothing when the only assignee is sent again", async () => {
    const ctx = await assigneeContext();
    const ana = await ctx.person("Ana");
    const task = await ctx.createTask([ana.id]);
    await age(task.id);

    const response = await ctx.call("PUT", `/task/assignee/${task.id}`, {
      userId: ana.id,
    });
    expect(response.status).toBe(200);
    expect(published).toEqual([]);
    expect((await storedTask(task.id)).updatedAt).toEqual(OLD);

    // Keeping one of several is still a change: the others go.
    const ben = await ctx.person("Ben");
    const pair = await ctx.createTask([ana.id, ben.id]);
    await ctx.call("PUT", `/task/assignee/${pair.id}`, { userId: ben.id });
    expect(await assigneeRows(pair.id)).toEqual([
      { userId: ben.id, position: 1 },
    ]);
  });
});
