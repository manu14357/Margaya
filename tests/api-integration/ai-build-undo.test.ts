import { eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAiGatewayState } from "../../apps/api/src/ai/gateway";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import type { InternalApi } from "../../apps/api/src/ai-build/dispatch";
import { BUILD_UNDO_TTL_MS, undoBuild } from "../../apps/api/src/ai-build/undo";
import db, { schema } from "../../apps/api/src/database";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

type Scene = Awaited<ReturnType<typeof draftScene>>;
type User = Scene["owner"];

type Report = {
  projectId: string | null;
  created: Record<string, number | boolean>;
  failures: unknown[];
  undoToken?: string;
};
type Refusal = {
  code: string;
  message: string;
  items: { kind: string; name: string }[];
  total: number;
};
type Undone = {
  removed: Record<string, number | boolean>;
  archived: number;
  failures: { kind: string; name: string; status: number }[];
};

const AI_ENV = ["MARGAYA_AI_ENABLED", "MARGAYA_AI_PROVIDER"] as const;

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
});

afterEach(() => {
  for (const name of AI_ENV) delete process.env[name];
});

async function aiScene() {
  const s = await draftScene();
  process.env.MARGAYA_AI_ENABLED = "true";
  process.env.MARGAYA_AI_PROVIDER = "fake";
  await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
  return s;
}

const task = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  description: "",
  priority: "no-priority",
  estimate: null,
  column: null,
  labels: [],
  cycleRef: null,
  moduleRef: null,
  subtasks: [],
  ...extra,
});

const plan = (extra: Record<string, unknown> = {}) => ({
  summary: "A plan.",
  project: null,
  columns: [],
  labels: [],
  cycles: [],
  modules: [],
  tasks: [],
  ...extra,
});

/** Everything the build makes in an existing project. */
const fullPlan = () =>
  plan({
    columns: [{ name: "QA" }, { name: "To Do" }],
    labels: [{ name: "Design", color: "purple" }],
    cycles: [
      {
        ref: "c1",
        name: "Sprint 1",
        description: "",
        startDate: "2026-12-01",
        endDate: "2026-12-14",
      },
    ],
    modules: [{ ref: "m1", name: "Content", description: "" }],
    tasks: [
      task("Write copy", {
        column: "QA",
        labels: ["Design"],
        cycleRef: "c1",
        moduleRef: "m1",
        subtasks: [{ title: "Home page" }],
      }),
      task("Ship it"),
    ],
  });

function apply(
  s: Scene,
  user: User,
  proposal: unknown,
  projectId?: string,
): Promise<Report> {
  return s.ok<Report>(user, "POST", "/ai/build/apply?stream=false", {
    workspaceId: s.workspaceId,
    ...(projectId ? { projectId } : {}),
    proposal,
  });
}

function undo(s: Scene, user: User, undoToken: string | undefined) {
  return s.as(user)("POST", "/ai/build/undo", {
    workspaceId: s.workspaceId,
    undoToken,
  });
}

async function taskByTitle(projectId: string, title: string) {
  const rows = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.projectId, projectId));
  const row = rows.find((candidate) => candidate.title === title);
  if (!row) throw new Error(`no task ${title}`);
  return row;
}

async function tasksIn(projectId: string) {
  return db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.projectId, projectId));
}

describe("undoing a plan from Build with AI", () => {
  it("sends a new project to the trash with everything in it", async () => {
    const s = await aiScene();
    const report = await apply(
      s,
      s.owner,
      plan({
        project: { name: "Relaunch", key: "RL", description: "Q4" },
        tasks: [task("First", { subtasks: [{ title: "Part" }] })],
      }),
    );
    expect(report.failures).toEqual([]);
    expect(report.undoToken).toBeTruthy();
    const projectId = report.projectId as string;

    const response = await undo(s, s.owner, report.undoToken);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      removed: { project: true },
      archived: 0,
      failures: [],
    });

    const [project] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, projectId));
    expect(project?.deletedAt).not.toBeNull();
    for (const row of await tasksIn(projectId)) {
      expect(row.deletedAt).not.toBeNull();
    }

    // Doing it twice changes nothing.
    const again = await undo(s, s.owner, report.undoToken);
    expect([404, 409]).toContain(again.status);
  });

  it("removes what it made in an existing project and nothing else", async () => {
    const s = await aiScene();
    const projectId = s.web.project.id;
    const before = await s.ok<{ id: string }>(
      s.owner,
      "POST",
      `/task/${projectId}`,
      {
        title: "Already here",
        description: "",
        priority: "low",
        status: "to-do",
      },
    );

    const report = await apply(s, s.owner, fullPlan(), projectId);
    expect(report.failures).toEqual([]);
    expect(report.created).toMatchObject({
      project: false,
      columns: 1,
      cycles: 1,
      modules: 1,
      tasks: 2,
      subtasks: 1,
    });

    const response = await undo(s, s.owner, report.undoToken);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Undone;
    expect(body.failures).toEqual([]);
    expect(body.removed).toMatchObject({
      project: false,
      columns: 1,
      cycles: 1,
      modules: 1,
      tasks: 2,
      subtasks: 1,
    });

    const rows = await tasksIn(projectId);
    const live = rows.filter((row) => row.deletedAt === null);
    expect(live.map((row) => row.id)).toEqual([before.id]);
    expect(
      await db
        .select()
        .from(schema.cycleTable)
        .where(eq(schema.cycleTable.projectId, projectId)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.moduleTable)
        .where(eq(schema.moduleTable.projectId, projectId)),
    ).toEqual([]);
    const columns = await db
      .select({ name: schema.columnTable.name })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, projectId));
    const names = columns.map((column) => column.name);
    // A column the plan reused stays; the one it added goes.
    expect(names).toContain("To Do");
    expect(names).not.toContain("QA");

    const again = await undo(s, s.owner, report.undoToken);
    expect(again.status).toBe(409);
    expect(((await again.json()) as Refusal).code).toBe("BUILD_ALREADY_UNDONE");
  });

  describe("refuses when something changed since, and changes nothing", () => {
    type Edit = (s: Scene, ids: { taskId: string }) => Promise<unknown>;
    const edits: [string, Edit, string][] = [
      [
        "a title",
        (s, { taskId }) =>
          s.ok(s.owner, "PUT", `/task/title/${taskId}`, { title: "Renamed" }),
        "Renamed",
      ],
      [
        "a description",
        (s, { taskId }) =>
          s.ok(s.owner, "PUT", `/task/description/${taskId}`, {
            description: "Someone's own notes",
          }),
        "Ship it",
      ],
      [
        "a comment",
        (s, { taskId }) =>
          s.ok(s.owner, "POST", `/comment/${taskId}`, { content: "Good one" }),
        "Ship it",
      ],
    ];

    for (const [name, edit, expected] of edits) {
      it(`on ${name}`, async () => {
        const s = await aiScene();
        const projectId = s.web.project.id;
        const report = await apply(s, s.owner, fullPlan(), projectId);
        const shipped = await taskByTitle(projectId, "Ship it");

        await edit(s, { taskId: shipped.id });

        const response = await undo(s, s.owner, report.undoToken);
        expect(response.status).toBe(409);
        const refusal = (await response.json()) as Refusal;
        expect(refusal.code).toBe("BUILD_EDITED");
        expect(refusal.total).toBe(1);
        expect(refusal.items).toEqual([{ kind: "task", name: expected }]);
        expect(refusal.message).toMatch(/nothing was undone/i);

        const rows = await tasksIn(projectId);
        expect(rows.every((row) => row.deletedAt === null)).toBe(true);
        expect(rows).toHaveLength(3);
        expect(
          await db
            .select()
            .from(schema.cycleTable)
            .where(eq(schema.cycleTable.projectId, projectId)),
        ).toHaveLength(1);
      });
    }

    it("on someone's own task put in a column or cycle it made", async () => {
      const s = await aiScene();
      const projectId = s.web.project.id;
      const report = await apply(s, s.owner, fullPlan(), projectId);
      const own = await s.ok<{ id: string }>(
        s.owner,
        "POST",
        `/task/${projectId}`,
        { title: "Mine", description: "", priority: "low", status: "to-do" },
      );
      const [cycle] = await db
        .select()
        .from(schema.cycleTable)
        .where(eq(schema.cycleTable.projectId, projectId));
      await s.ok(s.owner, "POST", `/cycle/${cycle?.id}/tasks`, {
        taskIds: [own.id],
      });

      const response = await undo(s, s.owner, report.undoToken);
      expect(response.status).toBe(409);
      expect((await response.json()) as Refusal).toMatchObject({
        code: "BUILD_EDITED",
        items: [{ kind: "cycle", name: "Sprint 1" }],
      });
    });

    it("on a task someone added to a new project", async () => {
      const s = await aiScene();
      const report = await apply(
        s,
        s.owner,
        plan({
          project: { name: "Relaunch", key: "RL", description: "" },
          tasks: [task("First")],
        }),
      );
      const projectId = report.projectId as string;
      await s.ok(s.owner, "POST", `/task/${projectId}`, {
        title: "Mine",
        description: "",
        priority: "low",
        status: "to-do",
      });

      const response = await undo(s, s.owner, report.undoToken);
      expect(response.status).toBe(409);
      expect((await response.json()) as Refusal).toMatchObject({
        code: "BUILD_EDITED",
        items: [{ kind: "project", name: "Relaunch" }],
      });
      const [project] = await db
        .select()
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, projectId));
      expect(project?.deletedAt).toBeNull();
    });
  });

  it("leaves alone a task someone already removed", async () => {
    const s = await aiScene();
    const projectId = s.web.project.id;
    const report = await apply(
      s,
      s.owner,
      plan({ tasks: [task("One"), task("Two")] }),
      projectId,
    );
    const one = await taskByTitle(projectId, "One");
    await s.ok(s.owner, "DELETE", `/task/${one.id}`);

    const response = await undo(s, s.owner, report.undoToken);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(((await response.json()) as Undone).removed.tasks).toBe(1);
  });

  it("archives what the caller may not delete, and lists what still failed", async () => {
    const s = await aiScene();
    const projectId = s.web.project.id;
    // A member may not delete tasks, nor a module someone else made.
    const report = await apply(
      s,
      s.mia,
      plan({
        modules: [{ ref: "m1", name: "Content", description: "" }],
        tasks: [task("Mia's task")],
      }),
      projectId,
    );
    expect(report.failures).toEqual([]);
    await db
      .update(schema.moduleTable)
      .set({ createdBy: s.ada.id })
      .where(eq(schema.moduleTable.projectId, projectId));

    const response = await undo(s, s.mia, report.undoToken);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Undone;
    expect(body.archived).toBe(1);
    expect(body.failures).toMatchObject([
      { kind: "module", name: "Content", status: 403 },
    ]);
    const row = await taskByTitle(projectId, "Mia's task");
    expect(row.archivedAt).not.toBeNull();
    expect(row.deletedAt).toBeNull();

    // What failed can be tried again; the archived task counts as gone.
    const again = await undo(s, s.owner, report.undoToken);
    expect(again.status).toBe(404);
    const retried = await undo(s, s.mia, report.undoToken);
    expect(retried.status).toBe(200);
    expect((await retried.json()) as Undone).toMatchObject({
      archived: 0,
      failures: [{ kind: "module" }],
    });
  });

  it("is only for the person who applied it", async () => {
    const s = await aiScene();
    const report = await apply(
      s,
      s.mia,
      plan({ tasks: [task("Mia's task")] }),
      s.web.project.id,
    );
    expect((await undo(s, s.ada, report.undoToken)).status).toBe(404);
    expect((await undo(s, s.mia, "not-a-token")).status).toBe(404);
    const elsewhere = await s.as(s.outsider)("POST", "/ai/build/undo", {
      workspaceId: s.workspaceId,
      undoToken: report.undoToken,
    });
    expect(elsewhere.status).toBe(403);
    const rows = await tasksIn(s.web.project.id);
    expect(rows.every((row) => row.deletedAt === null)).toBe(true);
  });

  it("expires after an hour", async () => {
    const s = await aiScene();
    const report = await apply(
      s,
      s.owner,
      plan({ tasks: [task("One")] }),
      s.web.project.id,
    );
    const call = vi.fn() as unknown as InternalApi;
    const expired = undoBuild({
      call,
      token: report.undoToken as string,
      userId: s.owner.id,
      workspaceId: s.workspaceId,
      now: Date.now() + BUILD_UNDO_TTL_MS + 1000,
    });
    await expect(expired).rejects.toBeInstanceOf(HTTPException);
    await expect(expired).rejects.toMatchObject({ status: 410 });
    expect(call).not.toHaveBeenCalled();
  });

  it("still works after AI is turned off", async () => {
    const s = await aiScene();
    const report = await apply(
      s,
      s.owner,
      plan({ tasks: [task("One")] }),
      s.web.project.id,
    );
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { enabled: false },
      s.owner.id,
    );
    expect((await undo(s, s.owner, report.undoToken)).status).toBe(200);
  });

  it("offers no undo when nothing was created", async () => {
    const s = await aiScene();
    const report = await apply(
      s,
      s.owner,
      plan({ columns: [{ name: "To Do" }] }),
      s.web.project.id,
    );
    expect(report.undoToken).toBeUndefined();
  });

  it("keeps the labels on the tasks they came with", async () => {
    const s = await aiScene();
    const projectId = s.web.project.id;
    const report = await apply(s, s.owner, fullPlan(), projectId);
    const written = await taskByTitle(projectId, "Write copy");

    expect((await undo(s, s.owner, report.undoToken)).status).toBe(200);

    const labels = await db
      .select({ name: schema.labelTable.name })
      .from(schema.labelTable)
      .where(inArray(schema.labelTable.taskId, [written.id]));
    expect(labels.map((label) => label.name)).toEqual(["Design"]);
  });
});
