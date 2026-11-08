import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { HIDDEN_LINK_MESSAGE } from "../../apps/api/src/task-relation/checks";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const m = vi.hoisted(() => ({ publish: vi.fn(async () => undefined) }));
vi.mock("../../apps/api/src/events", async (original) => ({
  ...(await original<object>()),
  publishEvent: m.publish,
}));
beforeEach(async () => {
  await resetTestDatabase();
  vi.clearAllMocks();
});
async function context() {
  const member = await createWorkspaceMember();
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({ projectId: project.id, title: "Private title", number: 1 })
    .returning();
  return { ...member, task };
}
function request(path: string, method: string, body?: unknown) {
  return createApp().app.request(`/api/task-relation${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}
async function seedRelation(sourceTaskId: string, targetTaskId: string) {
  const [relation] = await db
    .insert(schema.taskRelationTable)
    .values({ sourceTaskId, targetTaskId, relationType: "blocks" })
    .returning();
  return relation;
}

describe("task relation tenant boundaries", () => {
  it("rejects a foreign target and a nonexistent target identically", async () => {
    const own = await context();
    const foreign = await context();
    mockAuthenticatedSession(own.user);
    for (const targetTaskId of [foreign.task.id, "missing-task"]) {
      const response = await request("", "POST", {
        sourceTaskId: own.task.id,
        targetTaskId,
        relationType: "blocks",
      });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Target task not found");
    }
    expect(await db.query.taskRelationTable.findMany()).toHaveLength(0);
    expect(m.publish).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "hides legacy cross-workspace relations from reads in either direction (reverse=%s)",
    async (reverse) => {
      const own = await context();
      const foreign = await context();
      await seedRelation(
        reverse ? foreign.task.id : own.task.id,
        reverse ? own.task.id : foreign.task.id,
      );
      for (const member of [own, foreign]) {
        mockAuthenticatedSession(member.user);
        const response = await request(`/${member.task.id}`, "GET");
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
      }
    },
  );

  it("rejects deletion of a legacy foreign-target row without mutation or event", async () => {
    const own = await context();
    const foreign = await context();
    const relation = await seedRelation(own.task.id, foreign.task.id);
    mockAuthenticatedSession(own.user);
    const response = await request(`/${relation.id}`, "DELETE");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Task relation not found");
    expect(
      await db.query.taskRelationTable.findFirst({
        where: eq(schema.taskRelationTable.id, relation.id),
      }),
    ).toBeDefined();
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("requires source-workspace access for deletion even when the target is owned", async () => {
    const own = await context();
    const foreign = await context();
    const relation = await seedRelation(foreign.task.id, own.task.id);
    mockAuthenticatedSession(own.user);
    expect((await request(`/${relation.id}`, "DELETE")).status).toBe(403);
    expect(await db.query.taskRelationTable.findMany()).toHaveLength(1);
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("keeps same-workspace cross-project relations fully usable", async () => {
    const own = await context();
    const { project } = await createProjectFixture({
      workspaceId: own.workspace.id,
    });
    const [target] = await db
      .insert(schema.taskTable)
      .values({ projectId: project.id, title: "Related", number: 1 })
      .returning();
    mockAuthenticatedSession(own.user);
    const created = await request("", "POST", {
      sourceTaskId: own.task.id,
      targetTaskId: target.id,
      relationType: "related",
    });
    expect(created.status).toBe(200);
    const relation = (await created.json()) as { id: string };
    for (const task of [own.task, target]) {
      const response = await request(`/${task.id}`, "GET");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject([
        {
          id: relation.id,
          sourceTask: { id: own.task.id },
          targetTask: { id: target.id },
        },
      ]);
    }
    expect((await request(`/${relation.id}`, "DELETE")).status).toBe(200);
    expect(await db.query.taskRelationTable.findMany()).toHaveLength(0);
    expect(m.publish).toHaveBeenCalledWith(
      "task-relation.deleted",
      expect.objectContaining({
        sourceTaskId: own.task.id,
        targetTaskId: target.id,
      }),
    );
  });
});

describe("the loop check and tasks the caller can't see", () => {
  const CIRCULAR = "This would create a circular dependency";

  /** Two tasks a member sees, and a task in a restricted project they don't. */
  async function hiddenChainScene() {
    const own = await context();
    const task = async (projectId: string, number: number) => {
      const [row] = await db
        .insert(schema.taskTable)
        .values({ projectId, title: `Task ${number}`, number })
        .returning();
      if (!row) throw new Error("Failed to seed a task");
      return row;
    };
    const second = await task(own.task.projectId, 2);
    const third = await task(own.task.projectId, 3);
    const { project: restricted } = await createProjectFixture({
      workspaceId: own.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, restricted.id));
    const hidden = await task(restricted.id, 1);
    return { ...own, second, third, hidden };
  }

  const link = (sourceTaskId: string, targetTaskId: string) =>
    request("", "POST", { sourceTaskId, targetTaskId, relationType: "blocks" });

  it("refuses a loop closed through a hidden task without saying what it is", async () => {
    const s = await hiddenChainScene();
    // second -> hidden -> task, so task -> second would close a loop.
    await seedRelation(s.second.id, s.hidden.id);
    await seedRelation(s.hidden.id, s.task.id);
    mockAuthenticatedSession(s.user);

    const refused = await link(s.task.id, s.second.id);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe(HIDDEN_LINK_MESSAGE);
    expect(await db.query.taskRelationTable.findMany()).toHaveLength(2);
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("names a loop the caller can see, even when a hidden path closes it too", async () => {
    const s = await hiddenChainScene();
    await seedRelation(s.second.id, s.hidden.id);
    await seedRelation(s.hidden.id, s.task.id);
    await seedRelation(s.second.id, s.third.id);
    await seedRelation(s.third.id, s.task.id);
    mockAuthenticatedSession(s.user);

    const refused = await link(s.task.id, s.second.id);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe(CIRCULAR);
  });

  it("names the loop to someone who can see the whole chain", async () => {
    const s = await hiddenChainScene();
    await seedRelation(s.second.id, s.hidden.id);
    await seedRelation(s.hidden.id, s.task.id);
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "owner" })
      .where(eq(schema.workspaceUserTable.userId, s.user.id));
    mockAuthenticatedSession(s.user);

    const refused = await link(s.task.id, s.second.id);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe(CIRCULAR);
  });
});
