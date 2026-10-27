import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetAiGatewayState,
  setAiProviderFactory,
} from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import db, { schema } from "../../apps/api/src/database";
import {
  aiUsageTable,
  cycleTaskTable,
  moduleTaskTable,
  projectMemberTable,
} from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";
import {
  clearPublishedEvents,
  publishedEvents,
  recordEvents,
} from "./helpers/task-detail";

type Scene = Awaited<ReturnType<typeof draftScene>>;
type User = Scene["mia"];

recordEvents("task.created");

const AI_ENV = ["MARGAYA_AI_ENABLED", "MARGAYA_AI_PROVIDER"] as const;

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
  clearPublishedEvents();
});

afterEach(() => {
  for (const name of AI_ENV) delete process.env[name];
  setFakeResponder(null);
  setAiProviderFactory(null);
});

async function aiScene() {
  const s = await draftScene();
  process.env.MARGAYA_AI_ENABLED = "true";
  process.env.MARGAYA_AI_PROVIDER = "fake";
  await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
  return s;
}

/** Answers every structured (JSON) call with `value`. */
function scriptJson(value: unknown) {
  setFakeResponder((request) =>
    request.jsonSchema ? { text: JSON.stringify(value) } : null,
  );
}

async function usage(workspaceId: string, feature: string) {
  return db
    .select()
    .from(aiUsageTable)
    .where(
      and(
        eq(aiUsageTable.workspaceId, workspaceId),
        eq(aiUsageTable.feature, feature),
      ),
    );
}

async function createTask(
  s: Scene,
  user: User,
  title: string,
  description = "",
) {
  return s.ok<{ id: string; number: number }>(
    user,
    "POST",
    `/task/${s.web.project.id}`,
    { title, description, priority: "no-priority", status: "to-do" },
  );
}

async function restrictWeb(s: Scene, members: string[] = []) {
  await db
    .update(schema.projectTable)
    .set({ visibility: "restricted" })
    .where(eq(schema.projectTable.id, s.web.project.id));
  for (const userId of members) {
    await db
      .insert(projectMemberTable)
      .values({ projectId: s.web.project.id, userId, role: "member" });
  }
}

const PLAN = {
  summary: "Relaunch the website over two sprints.",
  project: { name: "Website relaunch", key: "WR", description: "Q4 relaunch" },
  columns: [{ name: "QA" }],
  labels: [{ name: "Design", color: "purple" }],
  cycles: [
    {
      ref: "c1",
      name: "Sprint 1",
      description: "",
      startDate: "2026-11-02",
      endDate: "2026-11-13",
    },
    {
      ref: "c2",
      name: "Sprint 2",
      description: "",
      startDate: "2026-11-16",
      endDate: "2026-11-27",
    },
  ],
  modules: [{ ref: "m1", name: "Content", description: "All copy" }],
  tasks: [
    {
      title: "Audit current pages",
      description: "List every page and its traffic.",
      priority: "high",
      estimate: 3,
      column: null,
      labels: ["Design"],
      cycleRef: "c1",
      moduleRef: "m1",
      subtasks: [{ title: "Export analytics" }, { title: "Tag owners" }],
    },
    {
      title: "Ship new homepage",
      description: "Build and launch the new homepage.",
      priority: "urgent",
      estimate: 8,
      column: "QA",
      labels: [],
      cycleRef: "c2",
      moduleRef: null,
      subtasks: [],
    },
  ],
};

type Report = {
  projectId: string | null;
  total: number;
  done: number;
  created: Record<string, number | boolean>;
  estimatesSkipped: boolean;
  failures: { kind: string; name: string; status: number }[];
};

describe("duplicate check on create", () => {
  it("ranks with full-text search, descriptions included, without AI", async () => {
    const s = await draftScene();
    const login = await createTask(s, s.mia, "Login page breaks on Safari");
    const body = await createTask(
      s,
      s.mia,
      "Checkout problem",
      "On Safari the login page breaks when paying.",
    );
    await createTask(s, s.mia, "Update the pricing page");

    const result = await s.ok<{ tasks: { id: string; key: string }[] }>(
      s.mia,
      "GET",
      `/task/similar/${s.web.project.id}?q=${encodeURIComponent("Safari login page breaks")}`,
    );
    expect(result.tasks.map((task) => task.id)).toEqual([login.id, body.id]);
    expect(result.tasks[0]?.key).toBe("WEB-1");
  });

  it("re-ranks candidates with a reason when AI is on", async () => {
    const s = await aiScene();
    await createTask(s, s.mia, "Login page breaks on Safari");
    await createTask(s, s.mia, "Safari login page is slow");
    await createTask(s, s.mia, "Login page Safari copy review");
    scriptJson({
      matches: [
        { key: "WEB-2", verdict: "related", reason: "Same page, speed" },
        { key: "WEB-1", verdict: "duplicate", reason: "Same bug, other words" },
        { key: "WEB-3", verdict: "different", reason: "Copy only" },
      ],
    });

    const result = await s.ok<{
      tasks: { key: string; verdict: string; reason: string }[];
    }>(s.mia, "POST", "/ai/build/duplicates", {
      projectId: s.web.project.id,
      title: "Safari login page broken",
    });
    expect(result.tasks).toEqual([
      expect.objectContaining({
        key: "WEB-1",
        verdict: "duplicate",
        reason: "Same bug, other words",
      }),
      expect.objectContaining({ key: "WEB-2", verdict: "related" }),
    ]);
    expect(await usage(s.workspaceId, "duplicate_check")).toHaveLength(1);

    // No candidates: no model call.
    const none = await s.ok<{ tasks: unknown[] }>(
      s.mia,
      "POST",
      "/ai/build/duplicates",
      { projectId: s.web.project.id, title: "Quarterly budget numbers" },
    );
    expect(none.tasks).toEqual([]);
    expect(await usage(s.workspaceId, "duplicate_check")).toHaveLength(1);
  });

  it("is refused to viewers, outsiders and AI-off projects", async () => {
    const s = await aiScene();
    const body = { projectId: s.web.project.id, title: "Login page broken" };
    expect(
      (await s.as(s.vic)("POST", "/ai/build/duplicates", body)).status,
    ).toBe(403);
    expect(
      (await s.as(s.outsider)("POST", "/ai/build/duplicates", body)).status,
    ).toBe(403);
    await db
      .update(schema.projectTable)
      .set({ aiEnabled: false })
      .where(eq(schema.projectTable.id, s.web.project.id));
    const off = await s.as(s.mia)("POST", "/ai/build/duplicates", body);
    expect(off.status).toBe(403);
  });
});

describe("talk to build: proposal", () => {
  it("turns a prompt into a normalized proposal for a new project", async () => {
    const s = await aiScene();
    scriptJson({
      ...PLAN,
      tasks: [{ ...PLAN.tasks[0], priority: "critical", cycleRef: "c9" }],
    });
    const result = await s.ok<{
      proposal: typeof PLAN;
      target: unknown;
      model: string;
    }>(s.mia, "POST", "/ai/build/proposal", {
      workspaceId: s.workspaceId,
      prompt: "plan a website relaunch for Q4 with 2 sprints",
    });
    expect(result.target).toBeNull();
    expect(result.proposal.project).toEqual(PLAN.project);
    expect(result.proposal.cycles).toHaveLength(2);
    expect(result.proposal.tasks[0]).toMatchObject({
      priority: "no-priority",
      cycleRef: null,
      moduleRef: "m1",
    });
    const rows = await usage(s.workspaceId, "talk_to_build");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tier).toBe("balanced");
  });

  it("builds into a visible project and says so to the model", async () => {
    const s = await aiScene();
    let prompt = "";
    setFakeResponder((request) => {
      prompt = JSON.stringify(request.messages);
      return { text: JSON.stringify(PLAN) };
    });
    const result = await s.ok<{
      proposal: typeof PLAN;
      target: { projectId: string };
    }>(s.mia, "POST", "/ai/build/proposal", {
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      prompt: "add a launch checklist",
      depth: "deep",
    });
    expect(result.target.projectId).toBe(s.web.project.id);
    expect(result.proposal.project).toBeNull();
    expect(prompt).toContain('<untrusted source=\\"project:WEB\\"');
    expect((await usage(s.workspaceId, "talk_to_build"))[0]?.tier).toBe("deep");
  });

  it("checks who may build where before calling the model", async () => {
    const s = await aiScene();
    scriptJson(PLAN);
    const ask = (user: User, extra: Record<string, unknown> = {}) =>
      s.as(user)("POST", "/ai/build/proposal", {
        workspaceId: s.workspaceId,
        prompt: "plan a relaunch",
        ...extra,
      });

    expect((await ask(s.vic)).status).toBe(403);
    expect((await ask(s.outsider)).status).toBe(403);
    await restrictWeb(s);
    expect((await ask(s.mia, { projectId: s.web.project.id })).status).toBe(
      404,
    );
    expect(await usage(s.workspaceId, "talk_to_build")).toHaveLength(0);
  });
});

describe("talk to build: apply", () => {
  it("creates a reviewed plan through the ordinary routes", async () => {
    const s = await aiScene();
    const report = await s.ok<Report>(
      s.ada,
      "POST",
      "/ai/build/apply?stream=false",
      { workspaceId: s.workspaceId, proposal: PLAN },
    );
    expect(report.failures).toEqual([]);
    expect(report.total).toBe(1 + 1 + 2 + 1 + 2 + 2);
    expect(report.done).toBe(report.total);
    expect(report.created).toEqual({
      project: true,
      columns: 1,
      cycles: 2,
      modules: 1,
      tasks: 2,
      subtasks: 2,
      labels: 1,
    });
    // No points system in a new project.
    expect(report.estimatesSkipped).toBe(true);

    const projectId = report.projectId as string;
    const [project] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, projectId));
    expect(project).toMatchObject({
      name: "Website relaunch",
      slug: "WR",
      description: "Q4 relaunch",
      workspaceId: s.workspaceId,
    });
    const tasks = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, projectId));
    expect(tasks).toHaveLength(4);
    expect(tasks.every((task) => task.createdBy === s.ada.id)).toBe(true);
    const homepage = tasks.find((task) => task.title === "Ship new homepage");
    expect(homepage?.status).toBe("qa");
    expect(homepage?.priority).toBe("urgent");

    const audit = tasks.find((task) => task.title === "Audit current pages");
    const subtasks = await db
      .select()
      .from(schema.taskRelationTable)
      .where(
        and(
          eq(schema.taskRelationTable.sourceTaskId, audit?.id ?? ""),
          eq(schema.taskRelationTable.relationType, "subtask"),
        ),
      );
    expect(subtasks).toHaveLength(2);
    const labels = await db
      .select()
      .from(schema.labelTable)
      .where(eq(schema.labelTable.taskId, audit?.id ?? ""));
    expect(labels.map((label) => [label.name, label.color])).toEqual([
      ["Design", "purple"],
    ]);
    const inCycles = await db
      .select()
      .from(cycleTaskTable)
      .where(
        inArray(
          cycleTaskTable.taskId,
          tasks.map((task) => task.id),
        ),
      );
    expect(inCycles).toHaveLength(2);
    const inModules = await db
      .select()
      .from(moduleTaskTable)
      .where(eq(moduleTaskTable.taskId, audit?.id ?? ""));
    expect(inModules).toHaveLength(1);
    // The ordinary create routes published their usual events.
    expect(publishedEvents("task.created").length).toBeGreaterThanOrEqual(4);
  });

  it("reports what the caller's permissions refused and keeps the rest", async () => {
    const s = await aiScene();
    const { points } = await s.insertEstimate();
    await s.insertCycle({
      name: "Existing",
      startDate: "2026-11-02",
      endDate: "2026-11-13",
    });
    const report = await s.ok<Report>(
      s.mia,
      "POST",
      "/ai/build/apply?stream=false",
      {
        workspaceId: s.workspaceId,
        projectId: s.web.project.id,
        proposal: { ...PLAN, project: null },
      },
    );
    // Members can't add columns (project:update); Sprint 1 overlaps.
    expect(
      report.failures.map((failure) => [
        failure.kind,
        failure.name,
        failure.status,
      ]),
    ).toEqual([
      ["column", "QA", 403],
      ["cycle", "Sprint 1", 409],
    ]);
    expect(report.created).toMatchObject({
      project: false,
      cycles: 1,
      modules: 1,
      tasks: 2,
      subtasks: 2,
    });
    expect(report.estimatesSkipped).toBe(false);
    const tasks = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, s.web.project.id));
    const homepage = tasks.find((task) => task.title === "Ship new homepage");
    // An unknown column falls back to the first one; 8 points → 3.
    expect(homepage?.status).toBe("to-do");
    expect(homepage?.estimatePointId).toBe(points[2]?.id);
  });

  it("refuses viewers and restricted projects without membership", async () => {
    const s = await aiScene();
    const apply = (user: User, projectId?: string) =>
      s.as(user)("POST", "/ai/build/apply?stream=false", {
        workspaceId: s.workspaceId,
        ...(projectId ? { projectId } : {}),
        proposal: projectId ? { ...PLAN, project: null } : PLAN,
      });

    expect((await apply(s.vic)).status).toBe(403);
    expect((await apply(s.vic, s.web.project.id)).status).toBe(403);
    await restrictWeb(s);
    expect((await apply(s.mia, s.web.project.id)).status).toBe(404);

    const projects = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.workspaceId, s.workspaceId));
    expect(projects).toHaveLength(2);
    const tasks = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, s.web.project.id));
    expect(tasks).toHaveLength(0);
  });

  it("streams progress, then the report", async () => {
    const s = await aiScene();
    const response = await s.as(s.ada)("POST", "/ai/build/apply", {
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      proposal: { ...PLAN, project: null, cycles: [], columns: [] },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = (await response.text())
      .split(/\n\n/)
      .map((block) => ({
        event: /event: (.+)/.exec(block)?.[1],
        data: /data: (.+)/.exec(block)?.[1],
      }))
      .filter((event) => event.event);
    const progress = events.filter((event) => event.event === "progress");
    const done = events.find((event) => event.event === "done");
    const report = JSON.parse(done?.data ?? "{}") as Report;
    expect(progress).toHaveLength(report.total);
    expect(JSON.parse(progress.at(-1)?.data ?? "{}")).toMatchObject({
      done: report.total,
      total: report.total,
    });
    expect(report.created).toMatchObject({ tasks: 2, subtasks: 2 });
  });
});
