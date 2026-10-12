import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { addWorkspaceMember } from "./helpers/fixtures";
import { json, type ModuleJson, moduleContext } from "./helpers/modules";

const events: Array<{ type: string; data: Record<string, unknown> }> = [];
for (const type of [
  "module.archived",
  "module.unarchived",
  "module.deleted",
  "module.reordered",
]) {
  await subscribeToEvent<Record<string, unknown>>(type, async (data) => {
    events.push({ type, data });
  });
}

describe("API integration: module list, order and lifecycle", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    events.length = 0;
  });

  it("filters and orders the list", async () => {
    const { list, insertModule, user, workspace } = await moduleContext();
    const colleague = await addWorkspaceMember(workspace.id);
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-02-01T00:00:00Z");
    const a = await insertModule({
      name: "Alpha 100%",
      position: 1,
      status: "planned",
      leadId: user.id,
      createdAt: older,
    });
    const b = await insertModule({
      name: "Beta",
      position: 1,
      status: "in-progress",
      createdAt: newer,
    });
    const c = await insertModule({ name: "Gamma", position: 0 });
    await insertModule({
      name: "Archived",
      status: "completed",
      archivedAt: new Date(),
    });
    await db
      .insert(schema.moduleMemberTable)
      .values({ moduleId: b.id, userId: colleague.id });

    // Position first, then newest first.
    expect((await list()).map((m) => m.id)).toEqual([c.id, b.id, a.id]);
    expect(
      (await list("?status=planned,in-progress")).map((m) => m.id),
    ).toEqual([b.id, a.id]);
    expect((await list(`?leadId=${user.id}`)).map((m) => m.id)).toEqual([a.id]);
    expect((await list(`?memberId=${colleague.id}`)).map((m) => m.id)).toEqual([
      b.id,
    ]);
    expect((await list("?search=ALPHA")).map((m) => m.id)).toEqual([a.id]);
    // % and _ are literal in the search.
    expect((await list("?search=100%25")).map((m) => m.id)).toEqual([a.id]);
    expect(await list("?search=%25a")).toEqual([]);
    expect((await list("?view=archived")).map((m) => m.name)).toEqual([
      "Archived",
    ]);
  });

  it("rejects unknown statuses and views", async () => {
    const { request, project } = await moduleContext();
    for (const query of ["?status=planned,done", "?view=all"]) {
      const response = await request(`/project/${project.id}${query}`);
      expect(response.status, query).toBe(400);
    }
  });

  it("reorders like projects: renumbered, omitted modules keep their rank", async () => {
    const { ok, request, project, createModule, insertModule, user } =
      await moduleContext();
    const archived = await insertModule({
      name: "Archived",
      position: 1,
      status: "completed",
      archivedAt: new Date(),
    });
    const a = await createModule({ name: "A" }); // position 0
    const b = await createModule({ name: "B" }); // -1
    const c = await createModule({ name: "C" }); // -2
    expect([a.position, b.position, c.position]).toEqual([0, -1, -2]);

    const reordered = await ok<ModuleJson[]>(
      `/project/${project.id}/reorder`,
      json("PUT", {
        modules: [
          { id: a.id, position: 0 },
          { id: c.id, position: 1 },
        ],
      }),
    );
    // Stored order was C, B, A, Archived; A and C swap slots around B.
    expect(reordered.map((m) => [m.name, m.position])).toEqual([
      ["A", 0],
      ["B", 1],
      ["C", 2],
    ]);
    const [stored] = await db
      .select({ position: schema.moduleTable.position })
      .from(schema.moduleTable)
      .where(eq(schema.moduleTable.id, archived.id));
    expect(stored?.position).toBe(3);
    expect(events.map((e) => e.type)).toEqual(["module.reordered"]);

    const duplicate = await request(
      `/project/${project.id}/reorder`,
      json("PUT", {
        modules: [
          { id: a.id, position: 0 },
          { id: a.id, position: 1 },
        ],
      }),
    );
    expect(duplicate.status).toBe(400);

    const other = await moduleContext();
    const foreign = await other.createModule({ name: "Foreign" });
    mockAuthenticatedSession(user);
    const smuggled = await request(
      `/project/${project.id}/reorder`,
      json("PUT", {
        modules: [
          { id: a.id, position: 0 },
          { id: foreign.id, position: 1 },
        ],
      }),
    );
    expect(smuggled.status).toBe(400);
    expect(await smuggled.text()).toBe(
      `Module ${foreign.id} does not belong to this project`,
    );
  });

  it("archives completed or cancelled modules only, idempotently", async () => {
    const { ok, request, list, createModule, user, workspace } =
      await moduleContext();
    const planned = await createModule({ name: "Planned", status: "planned" });
    const refused = await request(`/${planned.id}/archive`, { method: "POST" });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe(
      "Only completed or cancelled modules can be archived",
    );

    const done = await createModule({ name: "Done", status: "completed" });
    await db.insert(schema.favoriteTable).values({
      userId: user.id,
      workspaceId: workspace.id,
      entityType: "module",
      entityId: done.id,
    });

    const archived = await ok<ModuleJson>(`/${done.id}/archive`, {
      method: "POST",
    });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.status).toBe("completed");
    const again = await ok<ModuleJson>(`/${done.id}/archive`, {
      method: "POST",
    });
    expect(again.archivedAt).toBe(archived.archivedAt);
    expect(events.map((e) => e.type)).toEqual(["module.archived"]);
    // Archiving clears the module's favorites.
    expect(
      await db
        .select()
        .from(schema.favoriteTable)
        .where(eq(schema.favoriteTable.entityId, done.id)),
    ).toEqual([]);

    expect((await list()).map((m) => m.id)).toEqual([planned.id]);
    expect((await list("?view=archived")).map((m) => m.id)).toEqual([done.id]);

    const restored = await ok<ModuleJson>(`/${done.id}/unarchive`, {
      method: "POST",
    });
    expect(restored.archivedAt).toBeNull();
    await ok(`/${done.id}/unarchive`, { method: "POST" });
    expect(events.map((e) => e.type)).toEqual([
      "module.archived",
      "module.unarchived",
    ]);
  });

  it("lets admins delete any module and members only their own", async () => {
    const ctx = await moduleContext("member");
    const { request, createModule, createTask, link, workspace, user } = ctx;
    const admin = await addWorkspaceMember(workspace.id, "admin");
    const theirs = await ctx.insertModule({
      name: "Theirs",
      createdBy: admin.id,
    });
    const mine = await createModule({ name: "Mine", memberIds: [user.id] });
    const task = await createTask();
    const archivedTask = await createTask({ archivedAt: new Date() });
    await link(mine.id, [task.id, archivedTask.id]);
    await db.insert(schema.moduleLinkTable).values({
      moduleId: mine.id,
      url: "https://example.com/",
    });
    await db.insert(schema.recentVisitTable).values({
      userId: user.id,
      workspaceId: workspace.id,
      projectId: ctx.project.id,
      entityType: "module",
      entityId: mine.id,
    });

    const forbidden = await request(`/${theirs.id}`, { method: "DELETE" });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.text()).toBe(
      "Only workspace admins or the module's creator can delete it",
    );

    const deleted = await request(`/${mine.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const body = (await deleted.json()) as { removedTaskIds: string[] };
    expect(body.removedTaskIds.sort()).toEqual(
      [task.id, archivedTask.id].sort(),
    );

    // Tasks survive; links, members, memberships and references are gone.
    const tasks = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, ctx.project.id));
    expect(tasks).toHaveLength(2);
    for (const table of [
      schema.moduleTaskTable,
      schema.moduleMemberTable,
      schema.moduleLinkTable,
    ]) {
      expect(
        await db.select().from(table).where(eq(table.moduleId, mine.id)),
      ).toEqual([]);
    }
    expect(
      await db
        .select()
        .from(schema.recentVisitTable)
        .where(eq(schema.recentVisitTable.entityId, mine.id)),
    ).toEqual([]);

    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.taskId, task.id),
          eq(schema.activityTable.type, "module_removed"),
        ),
      );
    expect(activity).toMatchObject([
      {
        userId: user.id,
        content: null,
        eventData: {
          moduleId: mine.id,
          moduleName: "Mine",
          reason: "module_deleted",
        },
      },
    ]);
    expect(events).toContainEqual({
      type: "module.deleted",
      data: expect.objectContaining({ moduleId: mine.id, name: "Mine" }),
    });

    mockAuthenticatedSession(admin);
    const archived = await ctx.insertModule({
      name: "Archived",
      status: "completed",
      archivedAt: new Date(),
    });
    expect((await request(`/${theirs.id}`, { method: "DELETE" })).status).toBe(
      200,
    );
    // Archived modules can be deleted too.
    expect(
      (await request(`/${archived.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect((await request(`/${archived.id}`)).status).toBe(404);
  });
});
