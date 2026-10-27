import { and, eq } from "drizzle-orm";
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
  workspaceAiSettingTable,
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

/** Answers the planner's structured call with `value`. */
function scriptPlan(value: unknown) {
  setFakeResponder((request) =>
    request.jsonSchema ? { text: JSON.stringify(value) } : null,
  );
}

type Action = {
  id: string;
  op: string;
  title: string;
  risk: string;
  params: Record<string, unknown>;
  refs?: { tempId?: string };
  problem: { code: string; message: string } | null;
};
type Plan = {
  status: string;
  summary: string;
  actions: Action[];
  question?: { text: string; options: string[] };
  truncated: boolean;
  autopilot?: { applied: boolean; reason?: string };
  results?: Result[];
};
type Result = {
  actionId: string;
  ok: boolean;
  url?: string;
  label?: string;
  error?: string;
  skipped?: boolean;
  undoToken?: string;
};

async function createTask(s: Scene, title: string) {
  return s.ok<{ id: string; number: number }>(
    s.owner,
    "POST",
    `/task/${s.web.project.id}`,
    { title, description: "", priority: "no-priority", status: "to-do" },
  );
}

async function taskRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, id));
  return row;
}

function nx7Plan() {
  return {
    status: "proposal",
    summary: "A new project with one task, and WEB-1 moves on.",
    question: { text: "", options: [] },
    actions: [
      {
        op: "create_project",
        title: "Create project NX Sensor Fusion",
        detail: "",
        tempId: "p1",
        params: JSON.stringify({ name: "Sensor Fusion", key: "NX" }),
      },
      {
        op: "create_task",
        title: "Calibrate IMU",
        detail: "Assigned to Mia",
        tempId: "t1",
        params: JSON.stringify({
          projectRef: "p1",
          title: "Calibrate IMU",
          priority: "high",
          assigneeIds: ["Mia"],
          dueDate: "2026-11-20",
        }),
      },
      {
        op: "set_status",
        title: "Move WEB-1 to In Progress",
        detail: "",
        tempId: "",
        params: JSON.stringify({ taskId: "WEB-1", status: "In Progress" }),
      },
      {
        op: "add_comment",
        title: "Comment on WEB-1",
        detail: "",
        tempId: "",
        params: JSON.stringify({ taskId: "WEB-1", content: "Started." }),
      },
    ],
  };
}

describe("chat build: plan, apply, undo", () => {
  it("plans with resolved ids, applies as the caller, and undoes", async () => {
    const s = await aiScene();
    const web1 = await createTask(s, "Ship the homepage");
    scriptPlan(nx7Plan());

    const plan = await s.ok<Plan>(s.owner, "POST", "/ai/chat/plan", {
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      prompt: "Create NX Sensor Fusion with a task for Mia; start WEB-1",
    });
    expect(plan.status).toBe("proposal");
    expect(plan.actions.map((a) => [a.op, a.problem])).toEqual([
      ["create_project", null],
      ["create_task", null],
      ["set_status", null],
      ["add_comment", null],
    ]);
    expect(plan.actions[1]?.params).toMatchObject({
      projectRef: "p1",
      assigneeIds: [s.mia.id],
    });
    expect(plan.actions[2]?.params).toEqual({
      taskId: web1.id,
      status: "in-progress",
    });
    // Planning changes nothing and is on the usage ledger.
    expect(await taskRow(web1.id)).toMatchObject({ status: "to-do" });
    const usage = await db
      .select()
      .from(aiUsageTable)
      .where(
        and(
          eq(aiUsageTable.workspaceId, s.workspaceId),
          eq(aiUsageTable.feature, "build_chat"),
        ),
      );
    expect(usage).toHaveLength(1);

    clearPublishedEvents();
    const { results } = await s.ok<{ results: Result[] }>(
      s.owner,
      "POST",
      "/ai/chat/apply",
      { workspaceId: s.workspaceId, actions: plan.actions },
    );
    expect(results.map((r) => [r.actionId, r.ok, r.error])).toEqual([
      ["a1", true, undefined],
      ["a2", true, undefined],
      ["a3", true, undefined],
      ["a4", true, undefined],
    ]);
    const [project] = await db
      .select()
      .from(schema.projectTable)
      .where(
        and(
          eq(schema.projectTable.workspaceId, s.workspaceId),
          eq(schema.projectTable.slug, "NX"),
        ),
      );
    expect(project?.name).toBe("Sensor Fusion");
    expect(results[0]?.url).toBe(
      `/dashboard/workspace/${s.workspaceId}/project/${project?.id}/board`,
    );
    expect(results[1]?.label).toBe("NX-1 Calibrate IMU");
    const createdTaskId = results[1]?.url?.split("/task/")[1] ?? "";
    expect(await taskRow(createdTaskId)).toMatchObject({
      projectId: project?.id,
      priority: "high",
      createdBy: s.owner.id,
    });
    const assignees = await db
      .select()
      .from(schema.taskAssigneeTable)
      .where(eq(schema.taskAssigneeTable.taskId, createdTaskId));
    expect(assignees.map((row) => row.userId)).toEqual([s.mia.id]);
    expect(await taskRow(web1.id)).toMatchObject({ status: "in-progress" });
    // The ordinary routes published their events.
    expect(publishedEvents("task.created")).toHaveLength(1);

    // Undo the status change, then the created task.
    await s.ok(s.owner, "POST", "/ai/chat/undo", {
      workspaceId: s.workspaceId,
      undoToken: results[2]?.undoToken,
    });
    expect(await taskRow(web1.id)).toMatchObject({ status: "to-do" });
    const again = await s.as(s.owner)("POST", "/ai/chat/undo", {
      workspaceId: s.workspaceId,
      undoToken: results[2]?.undoToken,
    });
    expect(again.status).toBe(409);

    await s.ok(s.owner, "POST", "/ai/chat/undo", {
      workspaceId: s.workspaceId,
      undoToken: results[1]?.undoToken,
    });
    expect((await taskRow(createdTaskId))?.deletedAt).not.toBeNull();

    // Someone else's token reads as unknown.
    const foreign = await s.as(s.ada)("POST", "/ai/chat/undo", {
      workspaceId: s.workspaceId,
      undoToken: results[3]?.undoToken,
    });
    expect(foreign.status).toBe(404);
  });

  it("skips actions that depend on one that failed and keeps the rest", async () => {
    const s = await aiScene();
    const web1 = await createTask(s, "Ship the homepage");
    const results = (
      await s.ok<{ results: Result[] }>(s.owner, "POST", "/ai/chat/apply", {
        workspaceId: s.workspaceId,
        actions: [
          {
            id: "a1",
            op: "create_cycle",
            title: "Bad cycle",
            risk: "write",
            refs: { tempId: "c1" },
            params: {
              projectId: s.web.project.id,
              name: "Sprint",
              startDate: "2026-11-10",
              endDate: "2026-11-01",
            },
          },
          {
            id: "a2",
            op: "add_to_cycle",
            title: "Plan WEB-1",
            risk: "write",
            params: { cycleRef: "c1", taskIds: [web1.id] },
          },
          {
            id: "a3",
            op: "add_comment",
            title: "Comment",
            risk: "write",
            params: { taskId: web1.id, content: "Still here" },
          },
          {
            id: "a4",
            op: "delete_task",
            title: "Delete WEB-1",
            risk: "destructive",
            params: { taskId: web1.id },
          },
        ],
      })
    ).results;
    expect(results.map((r) => [r.actionId, r.ok, r.skipped ?? false])).toEqual([
      ["a1", false, true],
      ["a2", false, true],
      ["a3", true, false],
      // Destructive, and not ticked.
      ["a4", false, true],
    ]);
    expect((await taskRow(web1.id))?.deletedAt).toBeNull();
  });
});

describe("chat build: permissions", () => {
  it("refuses a viewer, and flags what a member may not do", async () => {
    const s = await aiScene();
    const web1 = await createTask(s, "Ship the homepage");
    scriptPlan({
      status: "proposal",
      summary: "Delete it.",
      question: { text: "", options: [] },
      actions: [
        {
          op: "delete_task",
          title: "Delete WEB-1",
          detail: "",
          tempId: "",
          params: JSON.stringify({ taskId: "WEB-1" }),
        },
      ],
    });

    // Viewers have no ai:use.
    const viewer = await s.as(s.vic)("POST", "/ai/chat/plan", {
      workspaceId: s.workspaceId,
      prompt: "Delete WEB-1",
    });
    expect(viewer.status).toBe(403);
    const viewerApply = await s.as(s.vic)("POST", "/ai/chat/apply", {
      workspaceId: s.workspaceId,
      actions: [
        {
          id: "a1",
          op: "add_comment",
          title: "Comment",
          risk: "write",
          params: { taskId: web1.id, content: "Hi" },
        },
      ],
    });
    expect(viewerApply.status).toBe(403);

    // Members can't delete tasks: flagged in the plan, skipped on apply.
    const plan = await s.ok<Plan>(s.mia, "POST", "/ai/chat/plan", {
      workspaceId: s.workspaceId,
      prompt: "Delete WEB-1",
    });
    expect(plan.actions[0]).toMatchObject({
      risk: "destructive",
      problem: { code: "forbidden" },
    });
    const { results } = await s.ok<{ results: Result[] }>(
      s.mia,
      "POST",
      "/ai/chat/apply",
      {
        workspaceId: s.workspaceId,
        actions: [{ ...plan.actions[0], problem: null }],
        confirmDestructive: ["a1"],
      },
    );
    expect(results[0]).toMatchObject({ ok: false, skipped: true });
    expect((await taskRow(web1.id))?.deletedAt).toBeNull();
  });

  it("does not reach projects the caller can't see", async () => {
    const s = await aiScene();
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.api.project.id));
    const { results } = await s.ok<{ results: Result[] }>(
      s.mia,
      "POST",
      "/ai/chat/apply",
      {
        workspaceId: s.workspaceId,
        actions: [
          {
            id: "a1",
            op: "create_task",
            title: "Sneak in",
            risk: "write",
            params: { projectId: s.api.project.id, title: "Sneak in" },
          },
        ],
      },
    );
    expect(results[0]).toMatchObject({ ok: false, skipped: true });
    expect(results[0]?.error).toBe("Project not found");
  });

  it("asks a question instead of guessing", async () => {
    const s = await aiScene();
    scriptPlan({
      status: "question",
      summary: "",
      question: { text: "Which project?", options: ["Web", "Api"] },
      actions: [],
    });
    const plan = await s.ok<Plan>(s.owner, "POST", "/ai/chat/plan", {
      workspaceId: s.workspaceId,
      prompt: "Add a task for the launch",
    });
    expect(plan).toMatchObject({
      status: "question",
      actions: [],
      question: { text: "Which project?", options: ["Web", "Api"] },
    });
  });
});

describe("chat build: the planning stream", () => {
  function parseSse(text: string) {
    return text
      .split(/\r?\n\r?\n/)
      .map((block) => {
        const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
        const data = /^data:\s*(.+)$/m.exec(block)?.[1];
        return event && data
          ? { event, data: JSON.parse(data) as Record<string, unknown> }
          : null;
      })
      .filter((event): event is NonNullable<typeof event> => event !== null);
  }

  it("streams what it read, the reasoning, then the plan; JSON stays the default", async () => {
    const s = await aiScene();
    const task = await createTask(s, "Audit page titles");
    const key = `WEB-${task.number}`;
    const other = await createTask(s, "Draft pricing copy");
    const otherKey = `WEB-${other.number}`;
    setFakeResponder((request) =>
      request.jsonSchema
        ? {
            reasoning: `${key} has no assignee; Mia is a member.`,
            text: JSON.stringify({
              status: "proposal",
              summary: `Assign ${key} to Mia.`,
              question: { text: "", options: [] },
              actions: [
                {
                  op: "assign",
                  title: `Assign ${key} to Mia`,
                  detail: "",
                  tempId: "",
                  params: JSON.stringify({ taskId: key, userIds: ["Mia"] }),
                },
              ],
            }),
          }
        : null,
    );
    const body = {
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      prompt: `${key} pls assign mia`,
      // An earlier answer's task isn't read when the request names its own.
      history: [
        { question: "What is blocked?", answer: `${otherKey} is blocked.` },
      ],
    };

    const response = await s.as(s.owner)("POST", "/ai/chat/plan", body, {
      accept: "text/event-stream",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await response.text());
    expect(events.map((event) => event.event)[0]).toBe("context");
    const context = events[0]?.data as {
      facts: { projects: number; tasks: number; members: number };
      items: { kind: string; title: string; url: string }[];
      earlierTurns: number;
    };
    expect(context.facts.projects).toBeGreaterThan(0);
    expect(context.items).toContainEqual(
      expect.objectContaining({
        kind: "task",
        title: expect.stringContaining(key),
      }),
    );
    expect(context.earlierTurns).toBe(1);
    expect(context.items.some((item) => item.title.includes(otherKey))).toBe(
      false,
    );
    expect(events.some((event) => event.event === "reasoning")).toBe(true);
    const done = events.at(-1);
    expect(done?.event).toBe("done");
    expect(done?.data).toMatchObject({
      status: "proposal",
      actions: [expect.objectContaining({ op: "assign", problem: null })],
    });
    expect(typeof done?.data.reasoningMs).toBe("number");

    // Callers that don't ask for a stream still get one JSON body.
    const plan = await s.ok<Plan & { reasoningMs: number | null }>(
      s.owner,
      "POST",
      "/ai/chat/plan",
      body,
    );
    expect(plan.status).toBe("proposal");
  });

  it("ends the stream with an error event when the model fails", async () => {
    const s = await aiScene();
    setFakeResponder((request) =>
      request.jsonSchema ? { text: "not json at all" } : null,
    );
    const response = await s.as(s.owner)(
      "POST",
      "/ai/chat/plan",
      { workspaceId: s.workspaceId, prompt: "Add a task" },
      { accept: "text/event-stream" },
    );
    const events = parseSse(await response.text());
    expect(events.at(-1)).toMatchObject({
      event: "error",
      data: { code: "AI_PROVIDER_ERROR" },
    });
  });
});

describe("chat build: autopilot", () => {
  it("applies only where the workspace allows it", async () => {
    const s = await aiScene();
    await createTask(s, "Ship the homepage");
    scriptPlan({
      status: "proposal",
      summary: "Comment.",
      question: { text: "", options: [] },
      actions: [
        {
          op: "add_comment",
          title: "Comment on WEB-1",
          detail: "",
          tempId: "",
          params: JSON.stringify({ taskId: "WEB-1", content: "Auto" }),
        },
      ],
    });
    const body = {
      workspaceId: s.workspaceId,
      prompt: "Comment on WEB-1",
      autopilot: true,
    };

    const off = await s.ok<Plan>(s.owner, "POST", "/ai/chat/plan", body);
    expect(off.autopilot).toEqual({ applied: false, reason: "AUTOPILOT_OFF" });
    expect(off.results).toBeUndefined();
    // Comments are activity rows of type "comment".
    const comments = () =>
      db
        .select()
        .from(schema.activityTable)
        .where(eq(schema.activityTable.type, "comment"));
    expect(await comments()).toHaveLength(0);

    await db
      .update(workspaceAiSettingTable)
      .set({ allowAutopilot: true })
      .where(eq(workspaceAiSettingTable.workspaceId, s.workspaceId));
    const on = await s.ok<Plan>(s.owner, "POST", "/ai/chat/plan", body);
    expect(on.autopilot).toEqual({ applied: true });
    expect(on.results?.[0]).toMatchObject({ ok: true });
    expect(on.results?.[0]?.undoToken).toBeTruthy();
    expect(await comments()).toHaveLength(1);

    // An approval rule for AI writes keeps Autopilot off.
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { requireApprovalForWrites: true },
      s.owner.id,
    );
    const held = await s.ok<Plan>(s.owner, "POST", "/ai/chat/plan", body);
    expect(held.autopilot?.applied).toBe(false);
  });
});
