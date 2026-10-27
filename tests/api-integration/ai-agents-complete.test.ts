import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAiGatewayState } from "../../apps/api/src/ai/gateway";
import { setFakeResponder } from "../../apps/api/src/ai/provider/fake";
import type { ChatRequest } from "../../apps/api/src/ai/types";
import { saveWorkspaceAiSettings } from "../../apps/api/src/ai/workspace-settings";
import {
  drainAgentRuns,
  maintainAgentRuns,
} from "../../apps/api/src/ai-agent/runner";
import { runAgentSchedules } from "../../apps/api/src/ai-agent/schedules";
import { settleAuditWrites } from "../../apps/api/src/audit-log/record";
import {
  forgetAutomationRules,
  settleAutomationRuns,
} from "../../apps/api/src/automation-rule/engine";
import db, { schema } from "../../apps/api/src/database";
import {
  activityTable,
  agentScheduleTable,
  aiConnectorTable,
  aiRunTable,
  aiSkillTable,
  auditLogTable,
  notificationTable,
  pageTable,
} from "../../apps/api/src/database/schema";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

// Agents, completed: schedules, the automation action "Run agent",
// questions that pause a run, per-agent project scope, skills, follow-ups
// ("chat") and outbound MCP connectors, through the real API.

type Scene = Awaited<ReturnType<typeof draftScene>>;
type AgentJson = { id: string; userId: string; name: string };
type RunJson = {
  id: string;
  status: string;
  error: string | null;
  trigger: string;
  followUpOf: string | null;
  question: { text: string; options: string[] } | null;
  outputSummary: string | null;
  task: { id: string } | null;
  project: { id: string } | null;
  steps: {
    id: string;
    toolName: string | null;
    status: string;
    canUndo: boolean;
    approval: { id: string; status: string } | null;
  }[];
};

const AI_ENV = [
  "MARGAYA_AI_ENABLED",
  "MARGAYA_AI_PROVIDER",
  "MARGAYA_AI_USER_CONCURRENCY",
  "MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS",
] as const;

beforeEach(async () => {
  await resetTestDatabase();
  resetRateLimitMemory();
  resetAiGatewayState();
  forgetAutomationRules();
});

afterEach(async () => {
  for (const name of AI_ENV) delete process.env[name];
  setFakeResponder(null);
  await settleAutomationRuns();
  await settleAuditWrites();
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
    name: "Atlas",
    instructions: "Keep things tidy.",
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

const getRun = (s: Scene, user: Scene["mia"], id: string) =>
  s.ok<RunJson>(
    user,
    "GET",
    `/ai/agents/runs/${id}?workspaceId=${s.workspaceId}`,
  );

async function startRun(
  s: Scene,
  user: Scene["mia"],
  agentId: string,
  taskId: string,
  prompt: string,
) {
  return s.ok<{ id: string }>(user, "POST", `/ai/agents/${agentId}/runs`, {
    workspaceId: s.workspaceId,
    taskId,
    prompt,
  });
}

const errorCode = async (response: Response) =>
  ((await response.json()) as { code?: string }).code;

describe("agent templates", () => {
  it("lists five templates for managers only", async () => {
    const { s } = await agentScene();
    const templates = await s.ok<{ id: string; suggestedSchedule: unknown }[]>(
      s.owner,
      "GET",
      `/ai/agents/templates?workspaceId=${s.workspaceId}`,
    );
    expect(templates.map((t) => t.id)).toEqual([
      "triage",
      "standup",
      "specWriter",
      "deliveryRisk",
      "feedback",
    ]);
    const denied = await s.as(s.mia)(
      "GET",
      `/ai/agents/templates?workspaceId=${s.workspaceId}`,
    );
    expect(denied.status).toBe(403);
  });
});

describe("agent schedules", () => {
  it("validates, claims each slot once across instances, and runs on the project", async () => {
    const { s, bot } = await agentScene();
    const base = `/ai/agents/${bot.id}/schedules`;
    const bad = await s.as(s.owner)("POST", base, {
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      cron: "* * * * *",
      timezone: "UTC",
      prompt: "Report",
    });
    expect(bad.status).toBe(400);
    expect(await errorCode(bad)).toBe("CRON_TOO_FREQUENT");
    const badZone = await s.as(s.owner)("POST", base, {
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      cron: "0 9 * * 1-5",
      timezone: "Nowhere/Land",
      prompt: "Report",
    });
    expect(await errorCode(badZone)).toBe("TIMEZONE_INVALID");
    const byMember = await s.as(s.mia)("POST", base, {
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      cron: "0 9 * * 1-5",
      timezone: "UTC",
      prompt: "Report",
    });
    expect(byMember.status).toBe(403);

    const schedule = await s.ok<{
      id: string;
      nextRunAt: string;
      runsAs: { id: string } | null;
      task: unknown;
    }>(s.owner, "POST", base, {
      workspaceId: s.workspaceId,
      projectId: s.web.project.id,
      cron: "0 9 * * 1-5",
      timezone: "Europe/Berlin",
      prompt: `Write the standup ${marker("create_page", { title: "Standup", content: "All quiet." })}`,
    });
    expect(schedule.runsAs?.id).toBe(s.owner.id);
    expect(schedule.task).toBeNull();
    expect(new Date(schedule.nextRunAt).getTime()).toBeGreaterThan(Date.now());

    // Due now: two instances race for the same slot.
    const due = new Date(Date.now() - 60_000);
    await db
      .update(agentScheduleTable)
      .set({ nextRunAt: due })
      .where(eq(agentScheduleTable.id, schedule.id));
    const now = new Date();
    const [first, second] = await Promise.all([
      runAgentSchedules(now),
      runAgentSchedules(now),
    ]);
    expect(first.queued + second.queued).toBe(1);
    expect((await runAgentSchedules(now)).queued).toBe(0);
    const [row] = await db
      .select()
      .from(agentScheduleTable)
      .where(eq(agentScheduleTable.id, schedule.id));
    expect(row?.lastRunAt?.getTime()).toBe(now.getTime());
    expect(row?.nextRunAt?.getTime()).toBeGreaterThan(now.getTime());

    expect(await drainAgentRuns()).toBe(1);
    const [runRow] = await db.select().from(aiRunTable);
    expect(runRow).toMatchObject({
      trigger: "schedule",
      taskId: null,
      projectId: s.web.project.id,
      principalUserId: s.owner.id,
      status: "succeeded",
    });
    const pages = await db
      .select()
      .from(pageTable)
      .where(eq(pageTable.projectId, s.web.project.id));
    expect(pages.map((page) => page.title)).toContain("Standup");
    const run = await getRun(s, s.owner, runRow?.id ?? "");
    expect(run.project?.id).toBe(s.web.project.id);
    expect(run.task).toBeNull();

    const listed = await s.ok<{ id: string; lastRunAt: string | null }[]>(
      s.owner,
      "GET",
      `${base}?workspaceId=${s.workspaceId}`,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.lastRunAt).not.toBeNull();

    const off = await s.ok<{ enabled: boolean; nextRunAt: string | null }>(
      s.owner,
      "PATCH",
      `${base}/${schedule.id}`,
      { workspaceId: s.workspaceId, enabled: false },
    );
    expect(off).toMatchObject({ enabled: false, nextRunAt: null });
    await s.ok(
      s.owner,
      "DELETE",
      `${base}/${schedule.id}?workspaceId=${s.workspaceId}`,
    );
    expect(await db.select().from(agentScheduleTable)).toHaveLength(0);
  });

  it("turns itself off when its person loses ai:use", async () => {
    const { s, bot } = await agentScene();
    const schedule = await s.ok<{ id: string }>(
      s.owner,
      "POST",
      `/ai/agents/${bot.id}/schedules`,
      {
        workspaceId: s.workspaceId,
        projectId: s.web.project.id,
        cron: "0 9 * * *",
        timezone: "UTC",
        prompt: "Report",
      },
    );
    // Vic (a viewer, no ai:use) is now the person it acts for.
    await db
      .update(agentScheduleTable)
      .set({ createdBy: s.vic.id, nextRunAt: new Date(Date.now() - 1_000) })
      .where(eq(agentScheduleTable.id, schedule.id));
    const outcome = await runAgentSchedules();
    expect(outcome).toMatchObject({ queued: 0, skipped: 1 });
    const [row] = await db
      .select()
      .from(agentScheduleTable)
      .where(eq(agentScheduleTable.id, schedule.id));
    expect(row).toMatchObject({ enabled: false, nextRunAt: null });
    expect(await db.select().from(aiRunTable)).toHaveLength(0);
    await settleAuditWrites();
    const entries = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "agent.schedule_disabled"));
    expect(entries[0]?.metadata).toMatchObject({ reason: "AI_USE_DENIED" });
  });
});

describe("the Run agent automation action", () => {
  it("runs the agent for the rule's owner, and never for an agent's own change", async () => {
    const { s, bot, task } = await agentScene();
    const columns = await db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, s.web.project.id));
    const inProgress = columns.find((c) => c.slug === "in-progress");
    const done = columns.find((c) => c.slug === "done");
    if (!inProgress || !done) throw new Error("columns missing");

    const unknown = await s.as(s.ada)(
      "POST",
      `/automation-rule/${s.web.project.id}`,
      {
        name: "Bad",
        trigger: { type: "status_changed" },
        actions: [{ type: "run_agent", agentId: "nope", prompt: "Hi" }],
      },
    );
    expect(unknown.status).toBe(400);

    await s.ok(s.ada, "POST", `/automation-rule/${s.web.project.id}`, {
      name: "Agent finishes started work",
      trigger: { type: "status_changed" },
      actions: [
        {
          type: "run_agent",
          agentId: bot.id,
          prompt: `Check {{task.key}} ${marker("move_status", { task: task.id, status: "done" })}`,
        },
      ],
    });

    await s.ok(s.mia, "PUT", `/task/status/${task.id}`, {
      status: "in-progress",
    });
    for (let round = 0; round < 4; round++) await settleAutomationRuns();
    let runs = await db.select().from(aiRunTable);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: "automation",
      principalUserId: s.ada.id,
      taskId: task.id,
    });

    // The agent moves the task: that status change starts no new run.
    expect(await drainAgentRuns()).toBe(1);
    for (let round = 0; round < 4; round++) await settleAutomationRuns();
    runs = await db.select().from(aiRunTable);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("succeeded");
    const [moved] = await db
      .select({ status: schema.taskTable.status })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(moved?.status).toBe("done");
  });

  it("needs ai:use from the person who saves the rule", async () => {
    const { s, bot } = await agentScene();
    // A custom role with project:update but no AI.
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "viewer" })
      .where(eq(schema.workspaceUserTable.userId, s.ada.id));
    const response = await s.as(s.ada)(
      "POST",
      `/automation-rule/${s.web.project.id}`,
      {
        name: "Run",
        trigger: { type: "comment_added" },
        actions: [{ type: "run_agent", agentId: bot.id, prompt: "Hi" }],
      },
    );
    expect(response.status).toBe(403);
  });
});

describe("questions (needs input)", () => {
  const scripted = () =>
    setFakeResponder((request: ChatRequest) => {
      const text = JSON.stringify(request.messages);
      if (text.includes("Answer from")) {
        return { text: "Deployed to staging as you said." };
      }
      if (text.includes("Asked. The run pauses")) return { text: "" };
      return {
        toolCalls: [
          {
            id: "q1",
            name: "ask_person",
            input: {
              question: "Which environment?",
              options: ["staging", "prod"],
            },
          },
        ],
      };
    });

  it("pauses for the person, then the same run continues with the answer", async () => {
    const { s, bot, task } = await agentScene();
    scripted();
    const started = await startRun(s, s.mia, bot.id, task.id, "Deploy it");
    await drainAgentRuns();
    let run = await getRun(s, s.mia, started.id);
    expect(run.status).toBe("needs_input");
    expect(run.question).toEqual({
      text: "Which environment?",
      options: ["staging", "prod"],
    });
    // Managers see that it waits, not the question.
    expect((await getRun(s, s.owner, started.id)).question).toBeNull();
    const [notice] = await db
      .select()
      .from(notificationTable)
      .where(eq(notificationTable.userId, s.mia.id));
    expect(notice).toMatchObject({
      type: "ai_agent_reply",
      content: "Which environment?",
    });
    expect(notice?.eventData).toMatchObject({
      needsInput: true,
      runId: started.id,
    });

    const other = await s.as(s.owner)(
      "POST",
      `/ai/agents/runs/${started.id}/reply`,
      { workspaceId: s.workspaceId, text: "prod" },
    );
    expect(other.status).toBe(403);
    const resumed = await s.ok<{ status: string }>(
      s.mia,
      "POST",
      `/ai/agents/runs/${started.id}/reply`,
      { workspaceId: s.workspaceId, text: "staging" },
    );
    expect(resumed.status).toBe("queued");
    const again = await s.as(s.mia)(
      "POST",
      `/ai/agents/runs/${started.id}/reply`,
      { workspaceId: s.workspaceId, text: "staging" },
    );
    expect(again.status).toBe(409);
    expect(await drainAgentRuns()).toBe(1);
    run = await getRun(s, s.mia, started.id);
    expect(run.status).toBe("succeeded");
    expect(run.outputSummary).toBe("Deployed to staging as you said.");
    expect(run.question).toBeNull();
    // Steps continue the same run's log.
    expect(
      run.steps.filter((step) => step.toolName === "ask_person"),
    ).toHaveLength(1);
    const [row] = await db
      .select({ input: aiRunTable.input })
      .from(aiRunTable)
      .where(eq(aiRunTable.id, started.id));
    expect(row?.input).toBeNull();
  });

  it("fails after 24 hours without an answer", async () => {
    const { s, bot, task } = await agentScene();
    scripted();
    const started = await startRun(s, s.mia, bot.id, task.id, "Deploy it");
    await drainAgentRuns();
    await db
      .update(aiRunTable)
      .set({
        input: {
          prompt: "Deploy it",
          question: "Which environment?",
          options: [],
          askedAt: new Date(Date.now() - 25 * 3_600_000).toISOString(),
        },
      })
      .where(eq(aiRunTable.id, started.id));
    const outcome = await maintainAgentRuns();
    expect(outcome.expiredQuestions).toBe(1);
    const run = await getRun(s, s.mia, started.id);
    expect(run).toMatchObject({
      status: "failed",
      error: "NEEDS_INPUT_EXPIRED",
    });
    const late = await s.as(s.mia)(
      "POST",
      `/ai/agents/runs/${started.id}/reply`,
      { workspaceId: s.workspaceId, text: "staging" },
    );
    expect(late.status).toBe(409);
  });
});

describe("per-agent project scope", () => {
  it("refuses runs outside the agent's projects and says so on the task", async () => {
    const { s, bot, task } = await agentScene();
    await s.ok(s.owner, "PATCH", `/ai/agents/${bot.id}`, {
      workspaceId: s.workspaceId,
      projectIds: [s.api.project.id],
    });
    const manual = await s.as(s.mia)("POST", `/ai/agents/${bot.id}/runs`, {
      workspaceId: s.workspaceId,
      taskId: task.id,
      prompt: "Look",
    });
    expect(manual.status).toBe(409);
    expect(await errorCode(manual)).toBe("OUTSIDE_AGENT_PROJECTS");

    await s.ok(s.mia, "POST", `/comment/${task.id}`, {
      content: `<margaya-mention id="${bot.userId}">@Atlas</margaya-mention> can you look?`,
    });
    expect(await drainAgentRuns()).toBe(1);
    const [runRow] = await db.select().from(aiRunTable);
    expect(runRow).toMatchObject({
      status: "failed",
      error: "OUTSIDE_AGENT_PROJECTS",
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
    expect(replies.map((row) => row.content).join(" ")).toContain(
      "not set up to work in this project",
    );

    const invalid = await s.as(s.owner)("PATCH", `/ai/agents/${bot.id}`, {
      workspaceId: s.workspaceId,
      projectIds: ["not-a-project"],
    });
    expect(invalid.status).toBe(400);
  });
});

describe("skills and follow-ups", () => {
  it("adds shared skills to the run and continues as a chat", async () => {
    const { s, bot, task } = await agentScene();
    const [skill] = await db
      .insert(aiSkillTable)
      .values({
        workspaceId: s.workspaceId,
        name: "Release notes",
        prompt: "Always write in the past tense.",
        shared: true,
        createdBy: s.owner.id,
      })
      .returning();
    const [secret] = await db
      .insert(aiSkillTable)
      .values({
        workspaceId: s.workspaceId,
        name: "Mine",
        prompt: "Private",
        shared: false,
        createdBy: s.mia.id,
      })
      .returning();
    const refused = await s.as(s.owner)("PATCH", `/ai/agents/${bot.id}`, {
      workspaceId: s.workspaceId,
      skillIds: [secret?.id],
    });
    expect(refused.status).toBe(400);
    const updated = await s.ok<{ skillIds: string[] }>(
      s.owner,
      "PATCH",
      `/ai/agents/${bot.id}`,
      { workspaceId: s.workspaceId, skillIds: [skill?.id] },
    );
    expect(updated.skillIds).toEqual([skill?.id]);

    const seen: string[] = [];
    setFakeResponder((request: ChatRequest) => {
      seen.push(JSON.stringify(request.messages));
      return { text: "Summary one." };
    });
    const first = await startRun(s, s.mia, bot.id, task.id, "Summarize");
    await drainAgentRuns();
    expect(seen[0]).toContain("Always write in the past tense.");

    const tooEarly = await s.ok<{ id: string }>(
      s.mia,
      "POST",
      `/ai/agents/runs/${first.id}/follow-up`,
      { workspaceId: s.workspaceId, text: "Shorter please" },
    );
    await drainAgentRuns();
    const chat = await getRun(s, s.mia, tooEarly.id);
    expect(chat).toMatchObject({
      trigger: "chat",
      followUpOf: first.id,
      status: "succeeded",
    });
    expect(chat.task?.id).toBe(task.id);
    expect(seen.at(-1)).toContain("Summary one.");
    expect(seen.at(-1)).toContain("Shorter please");
    // Without ai:use there is no chat; managers may continue any run.
    const stranger = await s.as(s.vic)(
      "POST",
      `/ai/agents/runs/${first.id}/follow-up`,
      { workspaceId: s.workspaceId, text: "Hi" },
    );
    expect(stranger.status).toBe(403);
  });
});

// --- A local MCP server (Streamable HTTP) ---

type McpCall = { method: string; auth: string | undefined; params: unknown };

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

async function mcpServer(token: string) {
  const calls: McpCall[] = [];
  const server: Server = createServer(async (request, response) => {
    const message = JSON.parse(await readBody(request)) as {
      id?: number;
      method: string;
      params?: Record<string, unknown>;
    };
    calls.push({
      method: message.method,
      auth: request.headers.authorization,
      params: message.params,
    });
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const reply = (result: unknown, sse = false) => {
      const body = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
      if (sse) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`event: message\ndata: ${body}\n\n`);
      } else {
        response.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": "session-1",
        });
        response.end(body);
      }
    };
    if (message.method === "initialize") {
      reply({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "tracker", version: "1" },
      });
    } else if (message.method === "tools/list") {
      reply({
        tools: [
          {
            name: "search_issues",
            description: "Search the issue tracker",
            inputSchema: {
              type: "object",
              properties: { q: { type: "string" } },
            },
            annotations: { readOnlyHint: true },
          },
          {
            name: "create_issue",
            description: "Open an issue",
            inputSchema: {
              type: "object",
              properties: { title: { type: "string" } },
            },
          },
        ],
      });
    } else if (message.method === "tools/call") {
      const name = (message.params?.name as string) ?? "";
      reply(
        {
          content: [
            {
              type: "text",
              text:
                name === "search_issues"
                  ? "TRK-7 Login times out"
                  : "Created TRK-8",
            },
          ],
        },
        true,
      );
    } else {
      response.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("MCP connectors", () => {
  it("keeps secrets sealed and separates shared from personal connectors", async () => {
    const { s } = await agentScene();
    process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    const server = await mcpServer("tok-abcdefgh1234");
    try {
      const connector = await s.ok<Record<string, unknown>>(
        s.owner,
        "POST",
        "/ai/connectors",
        {
          workspaceId: s.workspaceId,
          name: "Tracker",
          url: server.url,
          authType: "header",
          secret: "Bearer tok-abcdefgh1234",
          shared: true,
        },
      );
      expect(connector).toMatchObject({
        shared: true,
        hasSecret: true,
        secretLast4: "1234",
        headerName: "Authorization",
        canManage: true,
      });
      expect(JSON.stringify(connector)).not.toContain("tok-abcdefgh");
      const [row] = await db.select().from(aiConnectorTable);
      expect(row?.secret?.startsWith("sbx:v1:")).toBe(true);
      expect(row?.secret).not.toContain("tok-abcdefgh");

      // Members see the shared connector, without URL or secret hint.
      const seenByMia = await s.ok<Record<string, unknown>[]>(
        s.mia,
        "GET",
        `/ai/connectors?workspaceId=${s.workspaceId}`,
      );
      expect(seenByMia[0]).toMatchObject({
        url: null,
        secretLast4: null,
        canManage: false,
      });
      const sharedByMia = await s.as(s.mia)("POST", "/ai/connectors", {
        workspaceId: s.workspaceId,
        name: "Mine",
        url: server.url,
        authType: "none",
        shared: true,
      });
      expect(sharedByMia.status).toBe(403);
      const personal = await s.ok<{ id: string; ownerId: string }>(
        s.mia,
        "POST",
        "/ai/connectors",
        {
          workspaceId: s.workspaceId,
          name: "Mine",
          url: server.url,
          authType: "none",
          shared: false,
        },
      );
      expect(personal.ownerId).toBe(s.mia.id);
      const ownerList = await s.ok<{ id: string }[]>(
        s.owner,
        "GET",
        `/ai/connectors?workspaceId=${s.workspaceId}`,
      );
      expect(ownerList.map((c) => c.id)).not.toContain(personal.id);
      const editOthers = await s.as(s.mia)(
        "PATCH",
        `/ai/connectors/${connector.id}`,
        { workspaceId: s.workspaceId, enabled: false },
      );
      expect(editOthers.status).toBe(403);

      const test = await s.ok<{
        ok: boolean;
        tools: { name: string; readOnly: boolean }[];
      }>(s.owner, "POST", `/ai/connectors/${connector.id}/test`, {
        workspaceId: s.workspaceId,
      });
      expect(test.ok).toBe(true);
      expect(test.tools).toEqual([
        {
          name: "search_issues",
          description: "Search the issue tracker",
          readOnly: true,
        },
        { name: "create_issue", description: "Open an issue", readOnly: false },
      ]);
      const failing = await s.ok<{
        ok: boolean;
        error: string;
        httpStatus: number;
      }>(s.mia, "POST", `/ai/connectors/${personal.id}/test`, {
        workspaceId: s.workspaceId,
      });
      expect(failing).toMatchObject({
        ok: false,
        error: "HTTP",
        httpStatus: 401,
      });

      // Private addresses are refused unless the instance allows them.
      delete process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
      const privateUrl = await s.as(s.owner)(
        "PATCH",
        `/ai/connectors/${connector.id}`,
        { workspaceId: s.workspaceId, url: "http://127.0.0.1:9/other" },
      );
      expect(privateUrl.status).toBe(400);
      process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";

      await s.ok(
        s.owner,
        "DELETE",
        `/ai/connectors/${connector.id}?workspaceId=${s.workspaceId}`,
      );
      expect(await db.select().from(aiConnectorTable)).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("gives agents with web access read tools, and holds write tools for approval", async () => {
    const { s, bot, task } = await agentScene({ webAccess: true });
    process.env.MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    const server = await mcpServer("tok-abcdefgh1234");
    try {
      await s.ok(s.owner, "POST", "/ai/connectors", {
        workspaceId: s.workspaceId,
        name: "Tracker",
        url: server.url,
        authType: "header",
        secret: "Bearer tok-abcdefgh1234",
        shared: true,
      });
      const offered: string[][] = [];
      const results: string[] = [];
      setFakeResponder((request: ChatRequest) => {
        offered.push((request.tools ?? []).map((tool) => tool.name));
        results.push(JSON.stringify(request.messages));
        return null;
      });
      const read = await startRun(
        s,
        s.mia,
        bot.id,
        task.id,
        `Look it up ${marker("connector_tracker__search_issues", { q: "login" })}`,
      );
      await drainAgentRuns();
      expect(offered[0]).toEqual(
        expect.arrayContaining([
          "connector_tracker__search_issues",
          "connector_tracker__create_issue",
          "ask_person",
        ]),
      );
      expect(results.at(-1)).toContain("TRK-7 Login times out");
      expect(results.at(-1)).toContain("untrusted");
      expect((await getRun(s, s.mia, read.id)).status).toBe("succeeded");

      const write = await startRun(
        s,
        s.mia,
        bot.id,
        task.id,
        `File it ${marker("connector_tracker__create_issue", { title: "Login" })}`,
      );
      await drainAgentRuns();
      const held = await getRun(s, s.mia, write.id);
      const step = held.steps.find(
        (entry) => entry.toolName === "connector_tracker__create_issue",
      );
      expect(step?.status).toBe("pending");
      expect(held.status).toBe("awaiting_approval");
      expect(
        server.calls.filter(
          (call) =>
            call.method === "tools/call" &&
            (call.params as { name: string }).name === "create_issue",
        ),
      ).toHaveLength(0);

      await s.ok(
        s.mia,
        "POST",
        `/ai/agents/approvals/${step?.approval?.id}/approve`,
        { workspaceId: s.workspaceId },
      );
      const created = server.calls.filter(
        (call) =>
          call.method === "tools/call" &&
          (call.params as { name: string }).name === "create_issue",
      );
      expect(created).toHaveLength(1);
      expect(created[0]?.params).toMatchObject({
        arguments: { title: "Login" },
      });
      expect(created[0]?.auth).toBe("Bearer tok-abcdefgh1234");
      const after = await getRun(s, s.mia, write.id);
      expect(after.status).toBe("succeeded");
      // An outside call can't be undone.
      expect(after.steps.find((entry) => entry.id === step?.id)?.canUndo).toBe(
        false,
      );

      // Without web access the connector tools are not offered.
      await s.ok(s.owner, "PATCH", `/ai/agents/${bot.id}`, {
        workspaceId: s.workspaceId,
        webAccess: false,
      });
      offered.length = 0;
      await startRun(s, s.mia, bot.id, task.id, "Anything");
      await drainAgentRuns();
      expect(offered[0]?.some((name) => name.startsWith("connector_"))).toBe(
        false,
      );
    } finally {
      await server.close();
    }
  });
});
