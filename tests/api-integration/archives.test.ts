import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";
import { createProjectFixture } from "./helpers/fixtures";
import { orderedIds, type QueryResult } from "./helpers/task-query";

type Summary = {
  tasks: number | null;
  cycles: number | null;
  modules: number | null;
  projects: number | null;
};

type Entity = {
  type: string;
  id: string;
  name: string;
  projectId: string;
  projectSlug: string;
  archivedAt: string;
  details: Record<string, unknown>;
  canRestore: boolean;
  canDelete: boolean;
};

type EntityList = {
  items: Entity[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

beforeEach(async () => {
  await resetTestDatabase();
});

const at = (iso: string) => new Date(iso);

/**
 * web (active): archived done task, archived triage task, open task,
 * archived cycles (Mia's and Owen's), an active cycle, archived modules
 * (Mia's and Owen's) and an active one. api (archived) holds an archived
 * task and cycle. ops (archived) is empty.
 */
async function archiveScene() {
  const s = await draftScene();
  const web = s.web.project.id;
  const api = s.api.project.id;
  const ops = (
    await createProjectFixture({
      workspaceId: s.workspaceId,
      slug: "ops",
      name: "Operations",
    })
  ).project.id;
  await db
    .update(schema.projectTable)
    .set({ archivedAt: at("2026-03-01T00:00:00Z") })
    .where(eq(schema.projectTable.id, api));
  await db
    .update(schema.projectTable)
    .set({ archivedAt: at("2026-03-05T00:00:00Z") })
    .where(eq(schema.projectTable.id, ops));
  const [triage] = await db
    .insert(schema.columnTable)
    .values({
      projectId: web,
      name: "Triage",
      slug: "triage",
      group: "triage",
      position: 99,
    })
    .returning();

  const tasks = await db
    .insert(schema.taskTable)
    .values([
      {
        projectId: web,
        title: "Old done",
        number: 1,
        status: "done",
        archivedAt: at("2026-02-01T00:00:00Z"),
      },
      {
        projectId: web,
        title: "Newer done",
        number: 2,
        status: "done",
        archivedAt: at("2026-02-03T00:00:00Z"),
      },
      {
        projectId: web,
        title: "Request",
        number: 3,
        status: triage?.slug ?? "triage",
        archivedAt: at("2026-02-02T00:00:00Z"),
      },
      { projectId: web, title: "Open", number: 4, status: "to-do" },
      {
        projectId: api,
        title: "API archived",
        number: 1,
        status: "done",
        archivedAt: at("2026-02-04T00:00:00Z"),
      },
      { projectId: api, title: "API open", number: 2, status: "to-do" },
    ])
    .returning();

  const miaCycle = await s.insertCycle({
    name: "Alpha sprint",
    ownerId: s.mia.id,
    startDate: "2026-01-01",
    endDate: "2026-01-14",
    archivedAt: at("2026-02-10T00:00:00Z"),
  });
  const owenCycle = await s.insertCycle({
    name: "beta sprint",
    ownerId: s.owner.id,
    startDate: "2026-01-15",
    endDate: "2026-01-28",
    archivedAt: at("2026-02-10T00:00:00Z"),
  });
  await s.insertCycle({ name: "Current" });
  const apiCycle = await s.insertCycle({
    projectId: api,
    name: "API sprint",
    startDate: "2026-01-01",
    endDate: "2026-01-14",
    archivedAt: at("2026-02-11T00:00:00Z"),
  });

  const miaModule = await s.insertModule({
    name: "Mia module",
    status: "completed",
    createdBy: s.mia.id,
    archivedAt: at("2026-02-12T00:00:00Z"),
  });
  const owenModule = await s.insertModule({
    name: "Owen module",
    status: "cancelled",
    createdBy: s.owner.id,
    targetDate: "2026-01-20",
    archivedAt: at("2026-02-13T00:00:00Z"),
  });
  await s.insertModule({ name: "Active module" });

  return {
    ...s,
    ops,
    tasks,
    miaCycle,
    owenCycle,
    apiCycle,
    miaModule,
    owenModule,
  };
}

describe("archives: summary", () => {
  it("counts the workspace's archive and one project's, archived projects included", async () => {
    const s = await archiveScene();
    const summary = (user = s.owner, query = "") =>
      s.ok<Summary>(
        user,
        "GET",
        `/archive/summary?workspaceId=${s.workspaceId}${query}`,
      );

    expect(await summary()).toEqual({
      tasks: 2,
      cycles: 2,
      modules: 2,
      projects: 2,
    });
    expect(await summary(s.owner, `&projectId=${s.api.project.id}`)).toEqual({
      tasks: 1,
      cycles: 1,
      modules: 0,
      projects: null,
    });
    // Viewers read too.
    expect(await summary(s.vic)).toEqual({
      tasks: 2,
      cycles: 2,
      modules: 2,
      projects: 2,
    });
  });

  it("hides tabs for features that are off everywhere and for missing permissions", async () => {
    const s = await archiveScene();
    await db
      .update(schema.projectTable)
      .set({ cyclesEnabled: false })
      .where(eq(schema.projectTable.id, s.web.project.id));
    expect(
      await s.ok<Summary>(
        s.owner,
        "GET",
        `/archive/summary?workspaceId=${s.workspaceId}`,
      ),
    ).toMatchObject({ cycles: null, modules: 2 });

    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: s.workspaceId,
      role: "limited",
      permission: JSON.stringify({
        project: ["read"],
        workspace: ["read"],
        module: ["read"],
      }),
    });
    const limited = await addPerson(s.workspaceId, "Lim", "limited");
    expect(
      await s.ok<Summary>(
        limited,
        "GET",
        `/archive/summary?workspaceId=${s.workspaceId}`,
      ),
    ).toEqual({ tasks: null, cycles: null, modules: 2, projects: 2 });
    const refused = await s.as(limited)(
      "GET",
      `/archive/cycle?workspaceId=${s.workspaceId}`,
    );
    expect(refused.status).toBe(403);
    expect(await refused.text()).toBe("Insufficient permissions");
  });

  it("refuses unknown or foreign projects and projects inside a project", async () => {
    const s = await archiveScene();
    const foreign = await createProjectFixture({
      workspaceId: s.outsiderWorkspaceId,
      slug: "far",
    });
    for (const projectId of ["missing", foreign.project.id]) {
      const response = await s.as(s.owner)(
        "GET",
        `/archive/summary?workspaceId=${s.workspaceId}&projectId=${projectId}`,
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Project not found");
    }
    const inside = await s.as(s.owner)(
      "GET",
      `/archive/project?workspaceId=${s.workspaceId}&projectId=${s.web.project.id}`,
    );
    expect(inside.status).toBe(400);
    expect(await inside.text()).toBe(
      "Projects can't be listed inside a project",
    );

    await db
      .update(schema.projectTable)
      .set({ cyclesEnabled: false })
      .where(eq(schema.projectTable.id, s.web.project.id));
    const off = await s.as(s.owner)(
      "GET",
      `/archive/cycle?workspaceId=${s.workspaceId}&projectId=${s.web.project.id}`,
    );
    expect(off.status).toBe(403);
    expect(await off.text()).toBe(
      "The Cycles feature is turned off for this project.",
    );
    await expect(
      s.as(s.outsider)("GET", `/archive/summary?workspaceId=${s.workspaceId}`),
    ).resolves.toHaveProperty("status", 403);
  });
});

describe("archives: lists", () => {
  it("lists cycles newest archive first, then by name, with per-row rights", async () => {
    const s = await archiveScene();
    const list = (user: typeof s.owner, query = "") =>
      s.ok<EntityList>(
        user,
        "GET",
        `/archive/cycle?workspaceId=${s.workspaceId}${query}`,
      );

    const asMia = await list(s.mia);
    expect(asMia.items.map((item) => item.name)).toEqual([
      "Alpha sprint",
      "beta sprint",
    ]);
    expect(asMia.items[0]).toMatchObject({
      type: "cycle",
      id: s.miaCycle.id,
      projectSlug: "web",
      details: { startDate: "2026-01-01", endDate: "2026-01-14" },
      canRestore: true,
      canDelete: true,
    });
    expect(asMia.items[1]).toMatchObject({
      canRestore: true,
      canDelete: false,
    });
    expect(
      (await list(s.vic)).items.every((i) => !i.canRestore && !i.canDelete),
    ).toBe(true);
    expect(
      (await list(s.ada)).items.every((i) => i.canRestore && i.canDelete),
    ).toBe(true);

    expect(
      (await list(s.owner, "&search=BETA")).items.map((i) => i.id),
    ).toEqual([s.owenCycle.id]);
    const firstPage = await list(s.owner, "&limit=1");
    expect(firstPage).toMatchObject({ total: 2, hasMore: true });
    expect(firstPage.items.map((i) => i.id)).toEqual([s.miaCycle.id]);
    const pastEnd = await list(s.owner, "&limit=1&page=5");
    expect(pastEnd).toMatchObject({ items: [], total: 2, hasMore: false });

    const inApi = await list(s.owner, `&projectId=${s.api.project.id}`);
    expect(inApi.items.map((i) => i.id)).toEqual([s.apiCycle.id]);
  });

  it("lists modules with the creator's delete right", async () => {
    const s = await archiveScene();
    const asMia = await s.ok<EntityList>(
      s.mia,
      "GET",
      `/archive/module?workspaceId=${s.workspaceId}`,
    );
    expect(asMia.items.map((i) => [i.id, i.canRestore, i.canDelete])).toEqual([
      [s.owenModule.id, true, false],
      [s.miaModule.id, true, true],
    ]);
    expect(asMia.items[0]?.details).toEqual({
      status: "cancelled",
      targetDate: "2026-01-20",
    });
  });

  it("lists archived projects with their task counts", async () => {
    const s = await archiveScene();
    const asAdmin = await s.ok<EntityList>(
      s.ada,
      "GET",
      `/archive/project?workspaceId=${s.workspaceId}`,
    );
    expect(asAdmin.items.map((i) => [i.id, i.details.taskCount])).toEqual([
      [s.ops, 0],
      [s.api.project.id, 2],
    ]);
    expect(asAdmin.items[1]).toMatchObject({
      type: "project",
      projectId: s.api.project.id,
      projectSlug: "api",
      canRestore: true,
      canDelete: true,
    });
    const asMia = await s.ok<EntityList>(
      s.mia,
      "GET",
      `/archive/project?workspaceId=${s.workspaceId}`,
    );
    expect(asMia.items.every((i) => !i.canRestore && !i.canDelete)).toBe(true);
  });

  it("orders archived tasks by archive time in the query engine", async () => {
    const s = await archiveScene();
    const result = await s.ok<QueryResult>(s.owner, "POST", "/task-query", {
      workspaceId: s.workspaceId,
      scope: { projectIds: [s.web.project.id] },
      archived: "only",
      display: { orderBy: { field: "archivedAt" } },
    });
    const [oldDone, newerDone] = s.tasks;
    expect(orderedIds(result)).toEqual([newerDone?.id, oldDone?.id]);
    const ascending = await s.ok<QueryResult>(s.owner, "POST", "/task-query", {
      workspaceId: s.workspaceId,
      scope: { projectIds: [s.web.project.id] },
      archived: "only",
      display: { orderBy: { field: "archivedAt", direction: "asc" } },
    });
    expect(orderedIds(ascending)).toEqual([oldDone?.id, newerDone?.id]);
  });
});
