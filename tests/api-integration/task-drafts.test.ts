import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  type DraftJson,
  type DraftListJson,
  day,
  draftScene,
} from "./helpers/drafts";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
} from "./helpers/intake";

recordEvents("task_draft.changed");

beforeEach(async () => {
  await resetTestDatabase();
  clearPublishedEvents();
});

async function expectStatus(
  response: Promise<Response>,
  status: number,
  text?: string,
) {
  const resolved = await response;
  const body = await resolved.text();
  expect(resolved.status, body).toBe(status);
  if (text !== undefined) expect(body).toBe(text);
}

describe("drafts: create, read and privacy", () => {
  it("creates an untitled workspace-level draft from the workspace alone", async () => {
    const s = await draftScene();
    const draft = await s.createDraft(s.mia);
    expect(draft).toMatchObject({
      workspaceId: s.workspaceId,
      projectId: null,
      project: null,
      title: "",
      description: "",
      status: null,
      priority: "no-priority",
      assigneeIds: [],
      labels: [],
      startDate: null,
      dueDate: null,
      customFieldValues: [],
      cycleId: null,
      moduleIds: [],
      estimatePointId: null,
    });
    expect(publishedEvents("task_draft.changed").map((e) => e.data)).toEqual([
      expect.objectContaining({
        userId: s.mia.id,
        workspaceId: s.workspaceId,
        draftId: draft.id,
        action: "created",
      }),
    ]);
    // Ids only: nothing of the draft's content travels.
    expect(
      Object.keys(publishedEvents("task_draft.changed")[0]?.data ?? {}).sort(),
    ).toEqual(["action", "draftId", "initiatorId", "userId", "workspaceId"]);
  });

  it("round-trips every field of a project draft", async () => {
    const s = await draftScene();
    const field = await s.insertField();
    const draft = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      title: "  Ship the login page  ",
      description: "Some **markdown**",
      status: "in-progress",
      priority: "high",
      assigneeIds: [s.ada.id, s.mia.id, s.ada.id],
      labels: [
        { name: "UI", color: "purple" },
        { name: "Bug", color: "#ff0000" },
        { name: "ui", color: "teal" },
      ],
      startDate: "2026-05-01",
      dueDate: "2026-05-10",
      customFieldValues: [
        { fieldId: field.id, value: "Core" },
        { fieldId: field.id, value: "Growth" },
      ],
    });
    const read = await s.ok<DraftJson>(s.mia, "GET", `/task-draft/${draft.id}`);
    expect(read).toMatchObject({
      projectId: s.web.project.id,
      project: {
        id: s.web.project.id,
        slug: "web",
        archived: false,
      },
      title: "Ship the login page",
      description: "Some **markdown**",
      status: "in-progress",
      priority: "high",
      assigneeIds: [s.ada.id, s.mia.id],
      labels: [
        { name: "Bug", color: "#ff0000" },
        { name: "ui", color: "teal" },
      ],
      startDate: "2026-05-01T00:00:00.000Z",
      dueDate: "2026-05-10T00:00:00.000Z",
      customFieldValues: [{ fieldId: field.id, value: "Growth" }],
    });
  });

  it("lets a viewer read and delete their own draft but not create or edit", async () => {
    const s = await draftScene();
    await expectStatus(
      s.as(s.vic)("POST", "/task-draft", { workspaceId: s.workspaceId }),
      403,
    );
    const [seeded] = await db
      .insert(schema.taskDraftTable)
      .values({
        workspaceId: s.workspaceId,
        createdBy: s.vic.id,
        title: "From when I was a member",
      })
      .returning();
    if (!seeded) throw new Error("seed failed");

    const list = await s.ok<DraftListJson>(
      s.vic,
      "GET",
      `/task-draft?workspaceId=${s.workspaceId}`,
    );
    expect(list.drafts.map((d) => d.id)).toEqual([seeded.id]);
    await s.ok(s.vic, "GET", `/task-draft/${seeded.id}`);
    await expectStatus(
      s.as(s.vic)("PATCH", `/task-draft/${seeded.id}`, { title: "x" }),
      403,
    );
    await expectStatus(
      s.as(s.vic)("POST", `/task-draft/${seeded.id}/publish`, {}),
      403,
    );
    expect(await s.ok(s.vic, "DELETE", `/task-draft/${seeded.id}`)).toEqual({
      id: seeded.id,
    });
    expect(await s.draftRow(seeded.id)).toBeNull();
  });

  it("answers 404 to everyone but the owner, admins and owners included", async () => {
    const s = await draftScene();
    const draft = await s.createDraft(s.mia, { title: "Private" });
    for (const user of [s.ada, s.owner, s.outsider]) {
      await expectStatus(
        s.as(user)("GET", `/task-draft/${draft.id}`),
        404,
        "Draft not found",
      );
      await expectStatus(
        s.as(user)("PATCH", `/task-draft/${draft.id}`, { title: "Mine" }),
        404,
        "Draft not found",
      );
      await expectStatus(
        s.as(user)("POST", `/task-draft/${draft.id}/publish`, {}),
        404,
        "Draft not found",
      );
      await expectStatus(
        s.as(user)("DELETE", `/task-draft/${draft.id}`),
        404,
        "Draft not found",
      );
    }
    for (const user of [s.ada, s.owner]) {
      const list = await s.ok<DraftListJson>(
        user,
        "GET",
        `/task-draft?workspaceId=${s.workspaceId}`,
      );
      expect(list.total).toBe(0);
      expect(
        await s.ok(
          user,
          "GET",
          `/task-draft/count?workspaceId=${s.workspaceId}`,
        ),
      ).toEqual({ count: 0 });
    }
    // The outsider can't even list this workspace.
    await expectStatus(
      s.as(s.outsider)("GET", `/task-draft?workspaceId=${s.workspaceId}`),
      403,
    );
    expect((await s.draftRow(draft.id))?.title).toBe("Private");
  });

  it("hides a draft from its owner after they leave the workspace", async () => {
    const s = await draftScene();
    const draft = await s.createDraft(s.mia);
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, s.mia.id));
    await expectStatus(s.as(s.mia)("GET", `/task-draft/${draft.id}`), 403);
  });
});

describe("drafts: validation", () => {
  it("refuses values that need a project, or don't fit it", async () => {
    const s = await draftScene();
    const [triage] = await db
      .insert(schema.columnTable)
      .values({
        projectId: s.web.project.id,
        name: "Triage",
        slug: "triage",
        group: "triage",
        position: 99,
      })
      .returning();
    const otherField = await s.insertField({ projectId: s.api.project.id });
    const otherCycle = await s.insertCycle({ projectId: s.api.project.id });
    const web = { projectId: s.web.project.id };
    const create = (body: Record<string, unknown>) =>
      s.as(s.mia)("POST", "/task-draft", {
        workspaceId: s.workspaceId,
        ...body,
      });

    await expectStatus(
      create({ status: "to-do" }),
      400,
      "Choose a project before setting a status",
    );
    await expectStatus(
      create({ ...web, status: "archived" }),
      400,
      "Drafts can't be archived",
    );
    await expectStatus(create({ ...web, status: triage?.slug }), 400);
    await expectStatus(
      create({ assigneeIds: [s.outsider.id] }),
      400,
      "Assignee is not a member of this workspace",
    );
    await expectStatus(
      create({ startDate: "2026-05-10", dueDate: "2026-05-01" }),
      400,
      "Start date cannot be after due date. Please adjust the date range.",
    );
    await expectStatus(
      create({
        ...web,
        customFieldValues: [{ fieldId: otherField.id, value: "Core" }],
      }),
      400,
      "Custom field not found in this project",
    );
    await expectStatus(
      create({ ...web, cycleId: otherCycle.id }),
      400,
      "Cycle not found in this project",
    );
    await expectStatus(
      create({ projectId: "missing" }),
      404,
      "Project not found",
    );
    await expectStatus(
      create({ projectId: s.outsiderWorkspaceId }),
      404,
      "Project not found",
    );
    await expectStatus(create({ labels: [{ name: "x", color: "neon" }] }), 400);
    await expectStatus(create({ unknown: true }), 400);

    await db
      .update(schema.projectTable)
      .set({ cyclesEnabled: false })
      .where(eq(schema.projectTable.id, s.web.project.id));
    const cycle = await s.insertCycle();
    await expectStatus(
      create({ ...web, cycleId: cycle.id }),
      403,
      "The Cycles feature is turned off for this project.",
    );
  });

  it("refuses an archived project and the 1,001st draft", async () => {
    const s = await draftScene();
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, s.api.project.id));
    await expectStatus(
      s.as(s.mia)("POST", "/task-draft", {
        workspaceId: s.workspaceId,
        projectId: s.api.project.id,
      }),
      409,
      "This project is archived",
    );

    await db.insert(schema.taskDraftTable).values(
      Array.from({ length: 1000 }, (_, index) => ({
        workspaceId: s.workspaceId,
        createdBy: s.mia.id,
        title: `Draft ${index}`,
      })),
    );
    await expectStatus(
      s.as(s.mia)("POST", "/task-draft", { workspaceId: s.workspaceId }),
      409,
      "You can have up to 1,000 drafts in this workspace",
    );
    // The cap is per person: Ada still can.
    await s.createDraft(s.ada);
  });

  it("needs at least one field to change", async () => {
    const s = await draftScene();
    const draft = await s.createDraft(s.mia);
    await expectStatus(
      s.as(s.mia)("PATCH", `/task-draft/${draft.id}`, {}),
      400,
      "Provide at least one field to change",
    );
  });
});

describe("drafts: updates", () => {
  it("clears project-bound values on a project change and keeps people and labels", async () => {
    const s = await draftScene();
    const field = await s.insertField();
    const cycle = await s.insertCycle();
    const module = await s.insertModule();
    const { points } = await s.insertEstimate();
    const draft = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      status: "in-progress",
      assigneeIds: [s.ada.id],
      labels: [{ name: "UI", color: "purple" }],
      customFieldValues: [{ fieldId: field.id, value: "Core" }],
      cycleId: cycle.id,
      moduleIds: [module.id],
      estimatePointId: points[0]?.id,
    });

    const moved = await s.ok<DraftJson>(
      s.mia,
      "PATCH",
      `/task-draft/${draft.id}`,
      {
        projectId: s.api.project.id,
        status: "done",
      },
    );
    expect(moved).toMatchObject({
      projectId: s.api.project.id,
      status: "done",
      customFieldValues: [],
      cycleId: null,
      moduleIds: [],
      estimatePointId: null,
      assigneeIds: [s.ada.id],
      labels: [{ name: "UI", color: "purple" }],
    });

    // Values sent with the new project are checked against it.
    await expectStatus(
      s.as(s.mia)("PATCH", `/task-draft/${draft.id}`, {
        projectId: s.web.project.id,
        cycleId: (
          await s.insertCycle({
            projectId: s.api.project.id,
            name: "API sprint",
          })
        ).id,
      }),
      400,
      "Cycle not found in this project",
    );
    const back = await s.ok<DraftJson>(
      s.mia,
      "PATCH",
      `/task-draft/${draft.id}`,
      {
        projectId: null,
      },
    );
    expect(back).toMatchObject({ projectId: null, status: null });
  });

  it("blanks project-bound values once the project is deleted", async () => {
    const s = await draftScene();
    const draft = await s.createDraft(s.mia, {
      projectId: s.web.project.id,
      status: "to-do",
      title: "Keep me",
    });
    await db
      .delete(schema.projectTable)
      .where(eq(schema.projectTable.id, s.web.project.id));
    const read = await s.ok<DraftJson>(s.mia, "GET", `/task-draft/${draft.id}`);
    expect(read).toMatchObject({
      projectId: null,
      project: null,
      status: null,
      title: "Keep me",
    });
    // The stale value is still in the row until the next write.
    expect((await s.draftRow(draft.id))?.status).toBe("to-do");
  });

  it("writes and publishes nothing for a no-op update", async () => {
    const s = await draftScene();
    const draft = await s.createDraft(s.mia, {
      title: "Same",
      priority: "low",
    });
    clearPublishedEvents();
    const same = await s.ok<DraftJson>(
      s.mia,
      "PATCH",
      `/task-draft/${draft.id}`,
      {
        title: "Same",
        priority: "low",
      },
    );
    expect(same.updatedAt).toBe(draft.updatedAt);
    expect(publishedEvents("task_draft.changed")).toEqual([]);

    await s.ok(s.mia, "PATCH", `/task-draft/${draft.id}`, { title: "Changed" });
    expect(
      publishedEvents("task_draft.changed").map((e) => e.data.action),
    ).toEqual(["updated"]);
  });

  it("never moves the project's task counter", async () => {
    const s = await draftScene();
    const before = await s.lastTaskNumber();
    const draft = await s.createDraft(s.mia, { projectId: s.web.project.id });
    await s.ok(s.mia, "PATCH", `/task-draft/${draft.id}`, { title: "x" });
    await s.ok(s.mia, "DELETE", `/task-draft/${draft.id}`);
    expect(await s.lastTaskNumber()).toBe(before);
    expect(
      publishedEvents("task_draft.changed").map((e) => e.data.action),
    ).toEqual(["created", "updated", "deleted"]);
  });
});

describe("drafts: list and count", () => {
  it("pages newest edit first, filters by project and title, and counts", async () => {
    const s = await draftScene();
    const rows = await db
      .insert(schema.taskDraftTable)
      .values([
        {
          workspaceId: s.workspaceId,
          createdBy: s.mia.id,
          title: "Alpha login",
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          workspaceId: s.workspaceId,
          createdBy: s.mia.id,
          title: "Beta",
          projectId: s.web.project.id,
          updatedAt: new Date("2026-01-03T00:00:00Z"),
        },
        {
          workspaceId: s.workspaceId,
          createdBy: s.mia.id,
          title: "Gamma LOGIN",
          projectId: s.api.project.id,
          description: "text",
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
        {
          workspaceId: s.workspaceId,
          createdBy: s.ada.id,
          title: "Ada's login",
          updatedAt: new Date("2026-01-04T00:00:00Z"),
        },
      ])
      .returning();
    const [alpha, beta, gamma] = rows;
    const list = (query: string) =>
      s.ok<DraftListJson>(
        s.mia,
        "GET",
        `/task-draft?workspaceId=${s.workspaceId}${query}`,
      );

    const all = await list("");
    expect(all.drafts.map((d) => d.title)).toEqual([
      "Beta",
      "Gamma LOGIN",
      "Alpha login",
    ]);
    expect(all).toMatchObject({ total: 3, page: 1, limit: 50, hasMore: false });
    expect(all.drafts[1]).toMatchObject({ hasDescription: true });
    expect(all.drafts[1]).not.toHaveProperty("description");
    expect(all.drafts[0]?.project).toMatchObject({ slug: "web" });

    const first = await list("&limit=2");
    expect(first.drafts.map((d) => d.id)).toEqual([beta?.id, gamma?.id]);
    expect(first.hasMore).toBe(true);
    const second = await list("&limit=2&page=2");
    expect(second.drafts.map((d) => d.id)).toEqual([alpha?.id]);
    expect(second.hasMore).toBe(false);

    expect((await list("&projectId=none")).drafts.map((d) => d.id)).toEqual([
      alpha?.id,
    ]);
    expect(
      (await list(`&projectId=${s.web.project.id}`)).drafts.map((d) => d.id),
    ).toEqual([beta?.id]);
    expect((await list("&search=login")).drafts.map((d) => d.id)).toEqual([
      gamma?.id,
      alpha?.id,
    ]);
    expect((await list("&search=%25")).total).toBe(0);

    expect(
      await s.ok(
        s.mia,
        "GET",
        `/task-draft/count?workspaceId=${s.workspaceId}`,
      ),
    ).toEqual({ count: all.total });
  });

  it("keeps dates of a draft in the order they were given", async () => {
    const s = await draftScene();
    const draft = await s.createDraft(s.mia, { dueDate: `${day(3)}` });
    const cleared = await s.ok<DraftJson>(
      s.mia,
      "PATCH",
      `/task-draft/${draft.id}`,
      {
        dueDate: null,
        startDate: `${day(1)}`,
      },
    );
    expect(cleared.dueDate).toBeNull();
    expect(cleared.startDate).toBe(`${day(1)}T00:00:00.000Z`);
  });
});
