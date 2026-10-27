import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type SearchJson = {
  results: Array<{
    id: string;
    type: string;
    title: string;
    projectId?: string;
    status?: string;
    taskNumber?: number;
  }>;
};

type User = typeof schema.userTable.$inferSelect;

async function search(
  user: User,
  workspaceId: string,
  q: string,
  type = "all",
) {
  mockAuthenticatedSession(user);
  const { app } = createApp();
  const response = await app.request(
    `/api/search?${new URLSearchParams({ q, workspaceId, type })}`,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as SearchJson).results;
}

async function scene() {
  const owner = await createWorkspaceMember({ role: "admin" });
  const workspaceId = owner.workspace.id;
  const { project } = await createProjectFixture({ workspaceId, slug: "KIT" });
  await db
    .update(schema.projectTable)
    .set({ intakeEnabled: true })
    .where(eq(schema.projectTable.id, project.id));
  // Requests sit in the triage column, which task search leaves out.
  await db.insert(schema.columnTable).values({
    projectId: project.id,
    name: "Triage",
    slug: "triage",
    position: 99,
    group: "triage",
    isFinal: false,
  });

  const [cycle] = await db
    .insert(schema.cycleTable)
    .values({ projectId: project.id, name: "Kestrel sprint" })
    .returning();
  const [archivedCycle] = await db
    .insert(schema.cycleTable)
    .values({
      projectId: project.id,
      name: "Kestrel old",
      archivedAt: new Date(),
    })
    .returning();
  const [module] = await db
    .insert(schema.moduleTable)
    .values({
      projectId: project.id,
      name: "Payments",
      description: "Kestrel checkout",
      status: "in-progress",
    })
    .returning();
  const [sharedView] = await db
    .insert(schema.savedViewTable)
    .values({
      workspaceId,
      projectId: project.id,
      name: "Kestrel bugs",
      ownerId: owner.user.id,
    })
    .returning();
  const [privateView] = await db
    .insert(schema.savedViewTable)
    .values({
      workspaceId,
      name: "Kestrel mine",
      access: "private",
      ownerId: owner.user.id,
    })
    .returning();

  const requester = await addWorkspaceMember(workspaceId, "requester");
  await db.insert(schema.workspaceRoleTable).values({
    workspaceId,
    role: "requester",
    permission: JSON.stringify({
      project: ["read"],
      task: ["read"],
      intake: ["create"],
    }),
  });

  async function request(title: string, submittedBy: string, number: number) {
    const [task] = await db
      .insert(schema.taskTable)
      .values({ projectId: project.id, title, number, status: "triage" })
      .returning();
    const [item] = await db
      .insert(schema.intakeItemTable)
      .values({ projectId: project.id, taskId: task.id, submittedBy })
      .returning();
    return item;
  }
  const ownRequest = await request("Kestrel crash", requester.id, 1);
  const otherRequest = await request("Kestrel typo", owner.user.id, 2);
  const accepted = await request("Kestrel accepted", owner.user.id, 3);
  await db
    .update(schema.intakeItemTable)
    .set({ status: "accepted" })
    .where(eq(schema.intakeItemTable.id, accepted.id));

  return {
    owner,
    workspaceId,
    project,
    requester,
    cycle,
    archivedCycle,
    module,
    sharedView,
    privateView,
    ownRequest,
    otherRequest,
  };
}

describe("API integration: search over cycles, modules, views and intake", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("finds live cycles, modules, visible views and open requests", async () => {
    const s = await scene();
    const results = await search(s.owner.user, s.workspaceId, "kestrel");
    const ids = (type: string) =>
      results
        .filter((r) => r.type === type)
        .map((r) => r.id)
        .sort();

    expect(ids("cycle")).toEqual([s.cycle.id]);
    expect(ids("module")).toEqual([s.module.id]);
    expect(ids("view")).toEqual([s.privateView.id, s.sharedView.id].sort());
    expect(ids("intake")).toEqual([s.ownRequest.id, s.otherRequest.id].sort());
    const request = results.find((r) => r.id === s.ownRequest.id);
    expect(request).toMatchObject({ status: "pending", taskNumber: 1 });
    expect(results.find((r) => r.id === s.module.id)?.status).toBe(
      "in-progress",
    );
  });

  it("narrows to one kind with type", async () => {
    const s = await scene();
    const cycles = await search(
      s.owner.user,
      s.workspaceId,
      "kestrel",
      "cycles",
    );
    expect(cycles.map((r) => r.type)).toEqual(["cycle"]);
    const views = await search(s.owner.user, s.workspaceId, "kestrel", "views");
    expect(new Set(views.map((r) => r.type))).toEqual(new Set(["view"]));
  });

  it("hides other people's private views", async () => {
    const s = await scene();
    const member = await addWorkspaceMember(s.workspaceId, "member");
    const views = await search(member, s.workspaceId, "kestrel", "views");
    expect(views.map((r) => r.id)).toEqual([s.sharedView.id]);
  });

  it("keeps requester-only roles to their own requests and out of planning", async () => {
    const s = await scene();
    const results = await search(s.requester, s.workspaceId, "kestrel");
    expect(results.map((r) => [r.type, r.id])).toEqual([
      ["intake", s.ownRequest.id],
    ]);
  });

  it("leaves out projects with the feature off or in the trash", async () => {
    const s = await scene();
    await db
      .update(schema.projectTable)
      .set({
        cyclesEnabled: false,
        modulesEnabled: false,
        viewsEnabled: false,
        intakeEnabled: false,
      })
      .where(eq(schema.projectTable.id, s.project.id));
    const off = await search(s.owner.user, s.workspaceId, "kestrel");
    // The workspace view has no project, so no feature gates it.
    expect(off.map((r) => r.id)).toEqual([s.privateView.id]);

    await db
      .update(schema.projectTable)
      .set({
        cyclesEnabled: true,
        modulesEnabled: true,
        viewsEnabled: true,
        intakeEnabled: true,
        deletedAt: new Date(),
      })
      .where(eq(schema.projectTable.id, s.project.id));
    const trashed = await search(s.owner.user, s.workspaceId, "kestrel");
    expect(trashed.map((r) => r.id)).toEqual([s.privateView.id]);
  });

  it("never crosses workspace boundaries", async () => {
    const s = await scene();
    const outsider = await createWorkspaceMember({ role: "admin" });
    const results = await search(
      outsider.user,
      outsider.workspace.id,
      "kestrel",
    );
    expect(results).toEqual([]);

    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/search?${new URLSearchParams({ q: "kestrel", workspaceId: s.workspaceId })}`,
    );
    expect(response.status).toBe(403);
  });
});
