import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { resetTestDatabase } from "./helpers/database";
import { addWorkspaceMember, createWorkspaceMember } from "./helpers/fixtures";
import { day, json, type ModuleJson, moduleContext } from "./helpers/modules";

const events: Array<{ type: string; data: Record<string, unknown> }> = [];
for (const type of ["module.created", "module.updated"]) {
  await subscribeToEvent<Record<string, unknown>>(type, async (data) => {
    events.push({ type, data });
  });
}

describe("API integration: module create and update", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    events.length = 0;
  });

  it("creates modules with defaults, newest first", async () => {
    const { createModule, user, project } = await moduleContext();

    const first = await createModule({ name: "  Billing v2  " });
    expect(first).toMatchObject({
      projectId: project.id,
      name: "Billing v2",
      description: null,
      status: "backlog",
      startDate: null,
      targetDate: null,
      leadId: null,
      lead: null,
      memberIds: [],
      position: 0,
      archivedAt: null,
      counts: { total: 0, completed: 0, cancelled: 0 },
      pending: 0,
      progress: 0,
      createdBy: user.id,
    });

    const second = await createModule({
      name: "Onboarding",
      description: "   ",
      status: "planned",
      startDate: day(0),
      targetDate: day(10),
      leadId: user.id,
      memberIds: [user.id, user.id],
    });
    expect(second).toMatchObject({
      position: -1,
      description: null,
      status: "planned",
      startDate: day(0),
      targetDate: day(10),
      leadId: user.id,
      lead: { id: user.id, name: user.name },
      memberIds: [user.id],
    });

    expect(events).toContainEqual({
      type: "module.created",
      data: expect.objectContaining({
        moduleId: first.id,
        projectId: project.id,
        userId: user.id,
        name: "Billing v2",
      }),
    });
  });

  it.each([
    [{ name: "" }, "Module name is required"],
    [{ name: "   " }, "Module name is required"],
    [{ name: "x".repeat(256) }, "Module name must be at most 255 characters"],
    [
      { name: "A", description: "x".repeat(5001) },
      "Description must be at most 5000 characters",
    ],
    [{ name: "A", status: "done" }, "status"],
    [{ name: "A", startDate: "2026-02-30" }, "Invalid start date"],
    [{ name: "A", targetDate: "2026-3-01" }, "Invalid target date"],
    [{ name: "A", startDate: "2026-03-01T00:00:00Z" }, "Invalid start date"],
    [
      { name: "A", memberIds: Array.from({ length: 101 }, (_, i) => `u${i}`) },
      "memberIds",
    ],
  ])("rejects invalid input %#", async (body, message) => {
    const { request, project } = await moduleContext();
    const response = await request(
      `/project/${project.id}`,
      json("POST", body),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(message);
  });

  it("accepts 255 characters and 5000-character descriptions", async () => {
    const { createModule } = await moduleContext();
    const created = await createModule({
      name: "x".repeat(255),
      description: "d".repeat(5000),
    });
    expect(created.name).toHaveLength(255);
  });

  it("keeps names unique per project, ignoring case, archived included", async () => {
    const { request, project, createModule, insertModule } =
      await moduleContext();
    await createModule({ name: "Billing" });
    await insertModule({ name: "Legacy", archivedAt: new Date() });

    for (const name of ["billing", " BILLING ", "legacy"]) {
      const response = await request(
        `/project/${project.id}`,
        json("POST", { name }),
      );
      expect(response.status, name).toBe(409);
      expect(await response.text()).toBe(
        "A module with this name already exists",
      );
    }

    // Another project may reuse the name.
    const other = await moduleContext();
    await other.createModule({ name: "Billing" });
  });

  it("renames, including a case change of its own name", async () => {
    const { ok, request, createModule } = await moduleContext();
    const billing = await createModule({ name: "Billing" });
    await createModule({ name: "Onboarding" });

    const renamed = await ok<ModuleJson>(
      `/${billing.id}`,
      json("PUT", { name: "billing" }),
    );
    expect(renamed.name).toBe("billing");

    const taken = await request(
      `/${billing.id}`,
      json("PUT", { name: "onboarding" }),
    );
    expect(taken.status).toBe(409);

    const empty = await request(`/${billing.id}`, json("PUT", { name: " " }));
    expect(empty.status).toBe(400);
  });

  it("checks the date order against the stored dates", async () => {
    const { ok, request, project, createModule } = await moduleContext();
    const reversed = await request(
      `/project/${project.id}`,
      json("POST", { name: "A", startDate: day(5), targetDate: day(4) }),
    );
    expect(reversed.status).toBe(400);
    expect(await reversed.text()).toBe(
      "Start date cannot be after target date",
    );

    const created = await createModule({
      name: "B",
      startDate: day(0),
      targetDate: day(10),
    });
    // Only one side is sent; the stored other side still counts.
    const late = await request(
      `/${created.id}`,
      json("PUT", { startDate: day(11) }),
    );
    expect(late.status).toBe(400);
    const early = await request(
      `/${created.id}`,
      json("PUT", { targetDate: day(-1) }),
    );
    expect(early.status).toBe(400);

    // Same-day ranges and one-sided dates are fine; null clears.
    const sameDay = await ok<ModuleJson>(
      `/${created.id}`,
      json("PUT", { startDate: day(10) }),
    );
    expect(sameDay.startDate).toBe(day(10));
    const cleared = await ok<ModuleJson>(
      `/${created.id}`,
      json("PUT", { targetDate: null }),
    );
    expect(cleared).toMatchObject({ startDate: day(10), targetDate: null });
    const moved = await ok<ModuleJson>(
      `/${created.id}`,
      json("PUT", { startDate: day(40) }),
    );
    expect(moved.startDate).toBe(day(40));
  });

  it("only accepts workspace members as lead and members", async () => {
    const { request, project, workspace, createModule, ok, user } =
      await moduleContext();
    const outsider = await createWorkspaceMember();

    const badLead = await request(
      `/project/${project.id}`,
      json("POST", { name: "A", leadId: outsider.user.id }),
    );
    expect(badLead.status).toBe(400);
    expect(await badLead.text()).toBe(
      "Lead must be a member of this workspace",
    );

    const badMember = await request(
      `/project/${project.id}`,
      json("POST", { name: "A", memberIds: [user.id, outsider.user.id] }),
    );
    expect(badMember.status).toBe(400);
    expect(await badMember.text()).toBe(
      "Members must belong to this workspace",
    );

    const colleague = await addWorkspaceMember(workspace.id);
    const created = await createModule({
      name: "B",
      leadId: colleague.id,
      memberIds: [user.id],
    });
    // The lead is not added to the members.
    expect(created.memberIds).toEqual([user.id]);

    const replaced = await ok<ModuleJson>(
      `/${created.id}`,
      json("PUT", { memberIds: [colleague.id, colleague.id], leadId: null }),
    );
    expect(replaced).toMatchObject({
      memberIds: [colleague.id],
      leadId: null,
      lead: null,
    });
    const rows = await db
      .select()
      .from(schema.moduleMemberTable)
      .where(eq(schema.moduleMemberTable.moduleId, created.id));
    expect(rows.map((row) => row.userId)).toEqual([colleague.id]);
  });

  it("publishes changed fields and nothing for a no-op update", async () => {
    const { ok, createModule, user } = await moduleContext();
    const created = await createModule({
      name: "Billing",
      memberIds: [user.id],
    });
    events.length = 0;

    await ok(
      `/${created.id}`,
      json("PUT", {
        name: "Billing",
        status: "backlog",
        memberIds: [user.id],
        description: "",
      }),
    );
    expect(events).toEqual([]);

    const updated = await ok<ModuleJson>(
      `/${created.id}`,
      json("PUT", {
        status: "in-progress",
        description: "Plans",
        memberIds: [],
      }),
    );
    expect(updated).toMatchObject({
      status: "in-progress",
      description: "Plans",
      memberIds: [],
    });
    expect(events).toEqual([
      {
        type: "module.updated",
        data: expect.objectContaining({
          moduleId: created.id,
          changes: ["description", "status", "memberIds"],
        }),
      },
    ]);
  });

  it("refuses to edit archived modules", async () => {
    const { request, insertModule } = await moduleContext();
    const archived = await insertModule({
      name: "Done",
      status: "completed",
      archivedAt: new Date(),
    });
    const response = await request(
      `/${archived.id}`,
      json("PUT", { name: "Renamed" }),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("Restore the module before editing it");
  });

  it("returns the detail with links and members, archived included", async () => {
    const { ok, insertModule, user, workspace } = await moduleContext();
    const colleague = await addWorkspaceMember(workspace.id);
    const archived = await insertModule({
      name: "Old",
      status: "cancelled",
      archivedAt: new Date(),
    });
    await db.insert(schema.moduleMemberTable).values([
      { moduleId: archived.id, userId: user.id },
      { moduleId: archived.id, userId: colleague.id },
    ]);
    await db.insert(schema.moduleLinkTable).values({
      moduleId: archived.id,
      url: "https://example.com/",
      title: "Spec",
    });

    const detail = await ok<
      ModuleJson & {
        links: Array<{ url: string; title: string | null }>;
        members: Array<{ id: string; name: string }>;
      }
    >(`/${archived.id}`);
    expect(detail.archivedAt).not.toBeNull();
    expect(detail.links).toMatchObject([
      { url: "https://example.com/", title: "Spec" },
    ]);
    expect(detail.members.map((m) => m.id).sort()).toEqual(
      [user.id, colleague.id].sort(),
    );
  });
});
