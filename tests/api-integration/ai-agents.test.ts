import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetAiGatewayState,
  setAiProviderFactory,
} from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import type { AiProvider, ChatRequest } from "../../apps/api/src/ai/types";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import {
  refuseAgentInvitation,
  refuseAgentSession,
} from "../../apps/api/src/ai-agent/guards";
import {
  claimNextRun,
  drainAgentRuns,
  enqueueRun,
  runNextAgentRun,
} from "../../apps/api/src/ai-agent/runner";
import { billableMemberCount } from "../../apps/api/src/billing/seats";
import db, { schema } from "../../apps/api/src/database";
import {
  accountTable,
  activityTable,
  agentTable,
  aiRunStepTable,
  aiRunTable,
  notificationTable,
  projectMemberTable,
  workspaceRoleTable,
} from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { defaultRolePayloads } from "../../packages/permissions/src";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

type Scene = Awaited<ReturnType<typeof draftScene>>;
type User = Scene["mia"];

type AgentJson = { id: string; userId: string; name: string; role: string };
type StepJson = {
  id: string;
  kind: string;
  toolName: string | null;
  status: string;
  reason: string | null;
  canUndo: boolean;
  change: Record<string, unknown> | null;
  approval: { id: string; status: string; canDecide: boolean } | null;
};
type RunJson = {
  id: string;
  status: string;
  error: string | null;
  trigger: string;
  steps: StepJson[];
};

const AI_ENV = [
  "MARGAYA_AI_ENABLED",
  "MARGAYA_AI_PROVIDER",
  "MARGAYA_AI_USER_CONCURRENCY",
] as const;

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
});

afterEach(() => {
  for (const name of AI_ENV) delete process.env[name];
  setFakeResponder(null);
  setAiProviderFactory(null);
});

const marker = (tool: string, args: Record<string, unknown>) =>
  `[[fake:tool:${tool} ${JSON.stringify(args)}]]`;

async function agentScene(agent: Record<string, unknown> = {}) {
  process.env.MARGAYA_AI_ENABLED = "true";
  process.env.MARGAYA_AI_PROVIDER = "fake";
  process.env.MARGAYA_AI_USER_CONCURRENCY = "0";
  const s = await draftScene();
  await saveWorkspaceAiSettings(s.workspaceId, { enabled: true }, s.owner.id);
  const bot = await s.ok<AgentJson>(s.owner, "POST", "/ai/agents", {
    workspaceId: s.workspaceId,
    name: "Triage Bot",
    instructions: "Keep tasks tidy.",
    ...agent,
  });
  const task = await s.ok<{ id: string; status: string }>(
    s.mia,
    "POST",
    `/task/${s.web.project.id}`,
    {
      title: "Fix login timeout",
      description: "Users are logged out after a minute.",
      priority: "low",
      status: "to-do",
      assigneeIds: [],
    },
  );
  return { s, bot, task };
}

async function taskRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, id));
  return row;
}

async function run(
  s: Scene,
  user: User,
  agentId: string,
  taskId: string,
  prompt: string,
): Promise<RunJson> {
  const started = await s.ok<{ id: string }>(
    user,
    "POST",
    `/ai/agents/${agentId}/runs`,
    { workspaceId: s.workspaceId, taskId, prompt },
  );
  await drainAgentRuns();
  return s.ok<RunJson>(
    user,
    "GET",
    `/ai/agents/runs/${started.id}?workspaceId=${s.workspaceId}`,
  );
}

const toolSteps = (r: RunJson) =>
  r.steps.filter((step) => step.kind === "tool");

describe("agent identity", () => {
  it("is a member with a role, never a seat, and can't sign in or be invited", async () => {
    const { s, bot } = await agentScene({ role: "member" });

    const members = await s.ok<{ id: string; kind: string }[]>(
      s.mia,
      "GET",
      `/workspace/${s.workspaceId}/members`,
    );
    expect(members).toHaveLength(5);
    expect(members.find((m) => m.id === bot.userId)?.kind).toBe("agent");
    expect(members.filter((m) => m.kind === "human")).toHaveLength(4);
    // Seats count people only.
    expect(await billableMemberCount(s.workspaceId)).toBe(4);

    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, bot.userId));
    expect(user?.kind).toBe("agent");
    expect(user?.email).toMatch(/@agents\.margaya\.invalid$/);
    expect(
      await db
        .select()
        .from(accountTable)
        .where(eq(accountTable.userId, bot.userId)),
    ).toHaveLength(0);
    await expect(refuseAgentSession({ userId: bot.userId })).rejects.toThrow(
      "Agents can't sign in",
    );
    await expect(refuseAgentInvitation(user?.email)).rejects.toThrow(
      "Agents can't be invited",
    );
    await expect(
      refuseAgentSession({ userId: s.mia.id }),
    ).resolves.toBeUndefined();

    // Agents are never owners or admins; management needs ai:manage.
    const admin = await s.as(s.owner)("POST", "/ai/agents", {
      workspaceId: s.workspaceId,
      name: "Boss",
      role: "admin",
    });
    expect(admin.status).toBe(400);
    const byMember = await s.as(s.mia)("POST", "/ai/agents", {
      workspaceId: s.workspaceId,
      name: "Mine",
    });
    expect(byMember.status).toBe(403);
    const list = await s.ok<AgentJson[] & { instructions: string | null }[]>(
      s.vic,
      "GET",
      `/ai/agents?workspaceId=${s.workspaceId}`,
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.instructions).toBeNull();
  });

  it("is never notified, and deleting it keeps its history", async () => {
    const { s, bot, task } = await agentScene();
    await s.ok(s.owner, "PUT", `/task/assignees/${task.id}`, {
      assigneeIds: [bot.userId],
    });
    await drainAgentRuns();
    const notified = await db
      .select()
      .from(notificationTable)
      .where(eq(notificationTable.userId, bot.userId));
    expect(notified).toHaveLength(0);

    await s.ok(
      s.owner,
      "DELETE",
      `/ai/agents/${bot.id}?workspaceId=${s.workspaceId}`,
    );
    expect(await db.select().from(agentTable)).toHaveLength(0);
    const runs = await db.select().from(aiRunTable);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.agentId).toBeNull();
  });
});

describe("agent rights", () => {
  it("can't exceed the invoker: a viewer gets read-only behaviour", async () => {
    const { s, bot, task } = await agentScene();
    // A viewer allowed to use AI, still without task:update.
    await db.insert(workspaceRoleTable).values({
      workspaceId: s.workspaceId,
      role: "viewer",
      permission: JSON.stringify({
        ...defaultRolePayloads.viewer,
        ai: ["use"],
      }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const offered: string[][] = [];
    setFakeResponder((request: ChatRequest) => {
      offered.push((request.tools ?? []).map((tool) => tool.name));
      return null;
    });

    const result = await run(
      s,
      s.vic,
      bot.id,
      task.id,
      `Close it ${marker("move_status", { task: task.id, status: "done" })}`,
    );
    // Reads, and asking the person a question; no write tools.
    expect(offered[0]).toEqual([
      "read_task",
      "read_project",
      "read_page",
      "search_workspace",
      "ask_person",
    ]);
    const [step] = toolSteps(result);
    expect(step).toMatchObject({
      toolName: "move_status",
      status: "denied",
      reason: "NOT_ALLOWED",
    });
    expect((await taskRow(task.id))?.status).toBe("to-do");
    expect(result.status).toBe("succeeded");
  });

  it("never sees a restricted project that the invoker or the agent can't see", async () => {
    const { s, bot, task } = await agentScene();
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, s.api.project.id));
    await db.insert(projectMemberTable).values({
      projectId: s.api.project.id,
      userId: s.mia.id,
      role: "member",
    });
    const [secret] = await db
      .insert(schema.taskTable)
      .values({
        projectId: s.api.project.id,
        title: "Zebra launch secret",
        status: "to-do",
        number: 77,
      })
      .returning();
    if (!secret) throw new Error("no task");
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { includeRestricted: true },
      s.owner.id,
    );
    const seen: string[] = [];
    setFakeResponder((request: ChatRequest) => {
      seen.push(JSON.stringify(request.messages));
      return null;
    });

    // Mia sees the project, the agent is not a member: the run can't.
    const result = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Look ${marker("read_task", { task: secret.id })}`,
    );
    expect(toolSteps(result)[0]).toMatchObject({
      toolName: "read_task",
      status: "error",
    });
    expect(seen.join("\n")).not.toContain("Zebra launch secret");

    // Search never surfaces it either.
    seen.length = 0;
    const search = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Find ${marker("search_workspace", { query: "Zebra" })}`,
    );
    expect(toolSteps(search)[0]?.status).toBe("ok");
    expect(seen.join("\n")).not.toContain("Zebra launch secret");
    expect(seen.join("\n")).toContain("No results.");
  });
});

describe("change sets", () => {
  it("applies writes with attribution, and undo reverts them", async () => {
    const { s, bot, task } = await agentScene();
    const result = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Start it ${marker("move_status", { task: task.id, status: "in-progress" })}`,
    );
    const [step] = toolSteps(result);
    expect(step).toMatchObject({ status: "applied", canUndo: true });
    expect((await taskRow(task.id))?.status).toBe("in-progress");

    // "by Triage Bot on behalf of Mia"
    const [moved] = await db
      .select()
      .from(activityTable)
      .where(
        and(
          eq(activityTable.taskId, task.id),
          eq(activityTable.type, "status_changed"),
        ),
      );
    expect(moved?.userId).toBe(bot.userId);
    expect(moved?.eventData).toMatchObject({
      via: { agentName: "Triage Bot", onBehalfOf: s.mia.id, runId: result.id },
    });

    // Only the run's person (or ai:manage) may undo.
    const byVic = await s.as(s.vic)(
      "POST",
      `/ai/agents/steps/${step?.id}/undo`,
      {
        workspaceId: s.workspaceId,
      },
    );
    expect([403, 404]).toContain(byVic.status);
    await s.ok(s.mia, "POST", `/ai/agents/steps/${step?.id}/undo`, {
      workspaceId: s.workspaceId,
    });
    expect((await taskRow(task.id))?.status).toBe("to-do");
    const again = await s.as(s.mia)(
      "POST",
      `/ai/agents/steps/${step?.id}/undo`,
      { workspaceId: s.workspaceId },
    );
    expect(again.status).toBe(409);

    // A comment is undone by deleting it.
    const commented = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Say hi ${marker("add_comment", { task: task.id, body: "On it." })}`,
    );
    const [commentStep] = toolSteps(commented);
    const comments = () =>
      db
        .select()
        .from(activityTable)
        .where(
          and(
            eq(activityTable.taskId, task.id),
            eq(activityTable.type, "comment"),
          ),
        );
    const [comment] = await comments();
    expect(comment?.content).toBe("On it.");
    expect(comment?.eventData).toMatchObject({ via: { onBehalfOf: s.mia.id } });
    await s.ok(s.mia, "POST", `/ai/agents/steps/${commentStep?.id}/undo`, {
      workspaceId: s.workspaceId,
    });
    expect(await comments()).toHaveLength(0);
  });

  it("holds writes for approval; rejected changes never apply", async () => {
    const { s, bot, task } = await agentScene();
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { requireApprovalForWrites: true },
      s.owner.id,
    );
    const held = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Bump it ${marker("update_task", { task: task.id, priority: "high" })}`,
    );
    expect(held.status).toBe("awaiting_approval");
    const [step] = toolSteps(held);
    expect(step).toMatchObject({ status: "pending" });
    expect(step?.change).toMatchObject({
      op: "update_task",
      before: { priority: "low" },
      after: { priority: "high" },
    });
    expect((await taskRow(task.id))?.priority).toBe("low");

    // It waits in Mia's inbox.
    const inbox = await db
      .select()
      .from(notificationTable)
      .where(
        and(
          eq(notificationTable.userId, s.mia.id),
          eq(notificationTable.type, "ai_approval_requested"),
        ),
      );
    expect(inbox).toHaveLength(1);
    const approvals = await s.ok<{ id: string }[]>(
      s.mia,
      "GET",
      `/ai/agents/approvals?workspaceId=${s.workspaceId}`,
    );
    expect(approvals).toHaveLength(1);
    const approvalId = approvals[0]?.id;

    // Only Mia decides.
    const byAda = await s.as(s.ada)(
      "POST",
      `/ai/agents/approvals/${approvalId}/approve`,
      { workspaceId: s.workspaceId },
    );
    expect(byAda.status).toBe(403);
    await s.ok(s.mia, "POST", `/ai/agents/approvals/${approvalId}/approve`, {
      workspaceId: s.workspaceId,
    });
    expect((await taskRow(task.id))?.priority).toBe("high");
    const after = await s.ok<RunJson>(
      s.mia,
      "GET",
      `/ai/agents/runs/${held.id}?workspaceId=${s.workspaceId}`,
    );
    expect(after.status).toBe("succeeded");
    expect(toolSteps(after)[0]?.status).toBe("applied");

    // A rejected change is never applied.
    const rejected = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Rename ${marker("update_task", { task: task.id, title: "Nope" })}`,
    );
    const pending = toolSteps(rejected)[0]?.approval?.id;
    await s.ok(s.mia, "POST", `/ai/agents/approvals/${pending}/reject`, {
      workspaceId: s.workspaceId,
    });
    expect((await taskRow(task.id))?.title).toBe("Fix login timeout");
    const twice = await s.as(s.mia)(
      "POST",
      `/ai/agents/approvals/${pending}/approve`,
      { workspaceId: s.workspaceId },
    );
    expect(twice.status).toBe(409);
  });

  it("always holds destructive tools, even without the workspace setting", async () => {
    const { s, bot, task } = await agentScene();
    const other = await s.ok<{ id: string }>(
      s.mia,
      "POST",
      `/task/${s.web.project.id}`,
      {
        title: "Second",
        description: "",
        priority: "low",
        status: "to-do",
        assigneeIds: [],
      },
    );
    const result = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      marker("bulk_move_status", {
        tasks: [task.id, other.id],
        status: "done",
      }),
    );
    expect(toolSteps(result)[0]).toMatchObject({ status: "pending" });
    expect((await taskRow(task.id))?.status).toBe("to-do");
    expect((await taskRow(other.id))?.status).toBe("to-do");
  });
});

describe("triggers", () => {
  it("runs when mentioned in a comment, once per comment", async () => {
    const { s, bot, task } = await agentScene();
    await s.ok(s.mia, "POST", `/comment/${task.id}`, {
      content: `<margaya-mention id="${bot.userId}">@Triage Bot</margaya-mention> please ${marker("add_comment", { task: task.id, body: "Looking now." })}`,
    });
    expect(await drainAgentRuns()).toBe(1);
    const [runRow] = await db.select().from(aiRunTable);
    expect(runRow).toMatchObject({
      trigger: "mention",
      principalUserId: s.mia.id,
      status: "succeeded",
    });
    const replies = await db
      .select()
      .from(activityTable)
      .where(
        and(
          eq(activityTable.taskId, task.id),
          eq(activityTable.userId, bot.userId),
        ),
      );
    expect(replies.map((row) => row.content)).toContain("Looking now.");
    // The agent's own comment never triggers another run.
    expect(await drainAgentRuns()).toBe(0);
  });
});

describe("comment threads", () => {
  it("runs when someone replies under its comment, and answers in the thread", async () => {
    const { s, bot, task } = await agentScene();
    const [parent] = await db
      .insert(activityTable)
      .values({
        taskId: task.id,
        type: "comment",
        userId: bot.userId,
        content: "I set this to low priority.",
      })
      .returning();
    if (!parent) throw new Error("no parent comment");
    const prompts: string[] = [];
    setFakeResponder((request) => {
      prompts.push(
        request.messages
          .map((message) =>
            typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content),
          )
          .join("\n"),
      );
      return null;
    });

    // No mention: replying in the agent's thread addresses it.
    await s.ok(s.mia, "POST", `/comment/${task.id}`, {
      content: `Why low? ${marker("add_comment", { task: task.id, body: "It affects few users.", replyTo: parent.id })}`,
      parentId: parent.id,
    });
    expect(await drainAgentRuns()).toBe(1);
    const [runRow] = await db.select().from(aiRunTable);
    expect(runRow).toMatchObject({
      trigger: "mention",
      principalUserId: s.mia.id,
      status: "succeeded",
    });
    expect(prompts[0]).toContain(`thread of comment ${parent.id}`);
    expect(prompts[0]).toContain("I set this to low priority.");

    const answers = await db
      .select()
      .from(activityTable)
      .where(
        and(
          eq(activityTable.taskId, task.id),
          eq(activityTable.userId, bot.userId),
          eq(activityTable.content, "It affects few users."),
        ),
      );
    expect(answers).toHaveLength(1);
    expect(answers[0]?.parentId).toBe(parent.id);
    // The agent's own reply never triggers another run.
    expect(await drainAgentRuns()).toBe(0);
  });

  it("is not reached by replies under someone else's comment", async () => {
    const { s, task } = await agentScene();
    const parent = await s.ok<{ id: string }>(
      s.mia,
      "POST",
      `/comment/${task.id}`,
      { content: "A question for the team" },
    );
    await s.ok(s.owner, "POST", `/comment/${task.id}`, {
      content: "An answer",
      parentId: parent.id,
    });
    expect(await drainAgentRuns()).toBe(0);
  });
});

describe("the queue", () => {
  it("claims each run once under concurrent workers", async () => {
    const { s, bot, task } = await agentScene();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const row = await enqueueRun({
        workspaceId: s.workspaceId,
        projectId: s.web.project.id,
        taskId: task.id,
        agentId: bot.id,
        principalUserId: s.mia.id,
        trigger: "manual",
        dedupeKey: `test:${i}`,
        prompt: `Hello ${i}`,
      });
      if (row) ids.push(row.id);
    }
    // The same trigger twice queues once.
    expect(
      await enqueueRun({
        workspaceId: s.workspaceId,
        projectId: s.web.project.id,
        taskId: task.id,
        agentId: bot.id,
        principalUserId: s.mia.id,
        trigger: "manual",
        dedupeKey: "test:0",
      }),
    ).toBeNull();

    const processed = await Promise.all(
      Array.from({ length: 8 }, () => runNextAgentRun()),
    );
    const done = processed.filter((id): id is string => id !== null);
    expect(done.sort()).toEqual([...ids].sort());
    expect(await claimNextRun()).toBeNull();
    const models = await db
      .select()
      .from(aiRunStepTable)
      .where(eq(aiRunStepTable.kind, "model"));
    // One model call per run: no run was executed twice.
    expect(models).toHaveLength(5);
    const statuses = await db
      .select({ status: aiRunTable.status })
      .from(aiRunTable);
    expect(statuses.every((row) => row.status === "succeeded")).toBe(true);
  });

  it("stops a run when the agent's budget is used up", async () => {
    const { s, bot, task } = await agentScene({ monthlyBudgetMicros: 1 });
    let calls = 0;
    // A priced model that keeps calling a tool.
    const provider: AiProvider = {
      id: "fake",
      async *stream() {
        calls += 1;
        yield {
          type: "tool_call",
          call: {
            id: `c${calls}`,
            name: "read_task",
            input: { task: task.id },
          },
        };
        yield {
          type: "usage",
          model: "claude-sonnet-5-5",
          usage: { input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0 },
        };
        yield { type: "stop", reason: "tool_use" };
      },
    };
    setAiProviderFactory(() => provider);
    const result = await run(s, s.mia, bot.id, task.id, "Keep reading");
    expect(result.status).toBe("failed");
    expect(result.error).toBe("AI_BUDGET_EXCEEDED");
    expect(calls).toBe(1);
    expect(result.steps.filter((step) => step.kind === "model")).toHaveLength(
      1,
    );
  });

  it("refuses to queue a run once the agent's budget is used up", async () => {
    const { s, bot, task } = await agentScene({ monthlyBudgetMicros: 1 });
    const provider: AiProvider = {
      id: "fake",
      async *stream() {
        yield { type: "text", text: "Done." };
        yield {
          type: "usage",
          model: "claude-sonnet-5-5",
          usage: { input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0 },
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    setAiProviderFactory(() => provider);
    await run(s, s.mia, bot.id, task.id, "Look");
    const runsBefore = (await db.select().from(aiRunTable)).length;
    const refused = await s.as(s.mia)("POST", `/ai/agents/${bot.id}/runs`, {
      workspaceId: s.workspaceId,
      taskId: task.id,
      prompt: "Again",
    });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "AI_BUDGET_EXCEEDED" });
    expect(await db.select().from(aiRunTable)).toHaveLength(runsBefore);
  });
});

describe("agent names", () => {
  it("are unique in the workspace, ignoring case, among agents and people", async () => {
    const { s, bot } = await agentScene();
    for (const name of ["Triage Bot", "  triage BOT ", "mia"]) {
      const clash = await s.as(s.owner)("POST", "/ai/agents", {
        workspaceId: s.workspaceId,
        name,
      });
      expect(clash.status).toBe(409);
      expect(await clash.json()).toMatchObject({ code: "AGENT_NAME_TAKEN" });
    }
    const other = await s.ok<AgentJson>(s.owner, "POST", "/ai/agents", {
      workspaceId: s.workspaceId,
      name: "Maya",
    });
    const rename = await s.as(s.owner)("PATCH", `/ai/agents/${other.id}`, {
      workspaceId: s.workspaceId,
      name: "TRIAGE bot",
    });
    expect(rename.status).toBe(409);
    expect(await rename.json()).toMatchObject({ code: "AGENT_NAME_TAKEN" });
    // Its own name in another case, and other fields, are fine.
    await s.ok(s.owner, "PATCH", `/ai/agents/${bot.id}`, {
      workspaceId: s.workspaceId,
      name: "triage bot",
      description: "Tidies",
    });
    expect(
      (await db.select().from(agentTable)).map((row) => row.name).sort(),
    ).toEqual(["Maya", "triage bot"]);
  });
});

describe("comments of deleted authors", () => {
  it("stay in the task's comment list without an author", async () => {
    const { s, bot, task } = await agentScene();
    await run(
      s,
      s.mia,
      bot.id,
      task.id,
      `Say hi ${marker("add_comment", { task: task.id, body: "Agent note." })}`,
    );
    await s.ok(s.ada, "POST", `/comment/${task.id}`, {
      content: "Admin note.",
    });
    await s.ok(
      s.owner,
      "DELETE",
      `/ai/agents/${bot.id}?workspaceId=${s.workspaceId}`,
    );
    // A person's account deleted outright leaves user_id null too.
    await db.delete(schema.userTable).where(eq(schema.userTable.id, s.ada.id));

    type CommentJson = {
      content: string;
      userId: string | null;
      user: { name: string } | null;
    };
    const comments = await s.ok<CommentJson[]>(
      s.mia,
      "GET",
      `/comment/${task.id}`,
    );
    const byContent = new Map(comments.map((c) => [c.content, c]));
    expect(byContent.get("Agent note.")).toMatchObject({
      userId: null,
      user: null,
    });
    expect(byContent.get("Admin note.")).toMatchObject({
      userId: null,
      user: null,
    });
  });
});

describe("decided approvals", () => {
  it("settle the run with what was decided", async () => {
    const { s, bot, task } = await agentScene();
    await saveWorkspaceAiSettings(
      s.workspaceId,
      { requireApprovalForWrites: true },
      s.owner.id,
    );
    const decide = async (decision: "approve" | "reject", request: string) => {
      const held = await run(s, s.mia, bot.id, task.id, request);
      expect(held.status).toBe("awaiting_approval");
      const approvalId = toolSteps(held)[0]?.approval?.id;
      await s.ok(
        s.mia,
        "POST",
        `/ai/agents/approvals/${approvalId}/${decision}`,
        { workspaceId: s.workspaceId },
      );
      return s.ok<RunJson & { outputSummary: string | null }>(
        s.mia,
        "GET",
        `/ai/agents/runs/${held.id}?workspaceId=${s.workspaceId}`,
      );
    };

    const rejected = await decide(
      "reject",
      `Rename ${marker("update_task", { task: task.id, title: "Nope" })}`,
    );
    expect(rejected.status).toBe("cancelled");
    expect(rejected.outputSummary).toMatch(
      /Rejected: Update title of WEB-\d+ Fix login timeout\.$/,
    );
    expect(rejected.outputSummary).not.toContain("Approved:");

    const approved = await decide(
      "approve",
      `Bump ${marker("update_task", { task: task.id, priority: "high" })}`,
    );
    expect(approved.status).toBe("succeeded");
    expect(approved.outputSummary).toMatch(
      /Approved: Update priority of WEB-\d+ Fix login timeout\.$/,
    );
  });
});

describe("answers nobody would see", () => {
  it("reach the asker's inbox when the agent can't comment", async () => {
    const { s, bot, task } = await agentScene({ role: "viewer" });
    await s.ok(s.mia, "POST", `/comment/${task.id}`, {
      content: `<margaya-mention id="${bot.userId}">@Triage Bot</margaya-mention> why does this time out?`,
    });
    expect(await drainAgentRuns()).toBe(1);
    const [runRow] = await db.select().from(aiRunTable);
    expect(runRow?.status).toBe("succeeded");
    const fromBot = await db
      .select()
      .from(activityTable)
      .where(eq(activityTable.userId, bot.userId));
    expect(fromBot).toHaveLength(0);
    const [notice] = await db
      .select()
      .from(notificationTable)
      .where(
        and(
          eq(notificationTable.userId, s.mia.id),
          eq(notificationTable.type, "ai_agent_reply"),
        ),
      );
    expect(notice).toMatchObject({
      resourceId: task.id,
      resourceType: "task",
      actorId: bot.userId,
      content: runRow?.outputSummary?.trim(),
    });
    expect(notice?.eventData).toMatchObject({
      runId: runRow?.id,
      agentId: bot.id,
    });
  });

  it("stay on the task when the agent commented", async () => {
    const { s, bot, task } = await agentScene();
    await s.ok(s.mia, "POST", `/comment/${task.id}`, {
      content: `<margaya-mention id="${bot.userId}">@Triage Bot</margaya-mention> ${marker("add_comment", { task: task.id, body: "Here." })}`,
    });
    await drainAgentRuns();
    const notices = await db
      .select()
      .from(notificationTable)
      .where(eq(notificationTable.type, "ai_agent_reply"));
    expect(notices).toHaveLength(0);
  });
});

describe("assignment", () => {
  it("asks for a conservative first step, not a restructure", async () => {
    const { s, bot, task } = await agentScene();
    const requests: string[] = [];
    setFakeResponder((request: ChatRequest) => {
      requests.push(JSON.stringify(request.messages));
      return null;
    });
    await s.ok(s.owner, "PUT", `/task/assignees/${task.id}`, {
      assigneeIds: [bot.userId],
    });
    // The background worker may claim the run before the drain does.
    for (let i = 0; i < 50; i++) {
      await drainAgentRuns();
      const [row] = await db.select().from(aiRunTable);
      if (row && !["queued", "running"].includes(row.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const runs = await db.select().from(aiRunTable);
    expect(runs).toMatchObject([{ trigger: "assign", status: "succeeded" }]);
    expect(requests[0]).toContain("without further instructions");
    expect(requests[0]).toContain(
      "rewrite its description, or create sub-tasks, pages or links unless the task text asks for that",
    );
  });
});

describe("no-op changes", () => {
  it("treats an update to the current value as nothing to change", async () => {
    const { s, bot, task } = await agentScene();
    const result = await run(
      s,
      s.mia,
      bot.id,
      task.id,
      marker("update_task", { task: task.id, priority: "low" }),
    );
    expect(toolSteps(result)[0]).toMatchObject({
      toolName: "update_task",
      status: "ok",
      reason: "NO_CHANGE",
      change: null,
      canUndo: false,
    });
    expect(result.status).toBe("succeeded");
  });
});
