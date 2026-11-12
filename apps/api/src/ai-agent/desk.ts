import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { AiError } from "../ai/errors";
import { assertWithinBudget } from "../ai/usage";
import { loadWorkspaceAiPolicy } from "../ai/workspace-settings";
import db from "../database";
import {
  agentTable,
  aiApprovalTable,
  aiRunStepTable,
  aiRunTable,
  projectTable,
  taskTable,
  userTable,
} from "../database/schema";
import { jsonHttpError } from "../estimate/write";
import { canSeeProject, hiddenProjectIds } from "../project/visibility";
import { publishRunUpdated } from "./events";
import { agentMonthSpendMicros } from "./identity";
import { retainedInput } from "./run-state";
import { enqueueRun, kickAgentRunner } from "./runner";

// Agent Desk reads: runs, their steps (the change set) and approvals. People
// see their own runs; ai:manage sees every run of the workspace. Runs on
// projects the reader can't see are left out, like everything else.

const RUN_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "needs_input",
  "succeeded",
  "failed",
  "cancelled",
] as const;

/**
 * App paths for a change-set entry: the task it touched, and what it
 * created or pointed at (a page, a sub-task, the linked task).
 */
export function changeLinks(
  workspaceId: string,
  change: unknown,
  resultRef: unknown,
): { taskUrl: string | null; createdUrl: string | null } {
  const c = (change ?? {}) as Record<string, unknown>;
  const ref = (resultRef ?? {}) as Record<string, unknown>;
  const text = (value: unknown) =>
    typeof value === "string" && value ? value : null;
  const projectId = text(c.projectId);
  const base = `/dashboard/workspace/${workspaceId}/project/${projectId}`;
  const taskPath = (id: string | null) => (id ? `${base}/task/${id}` : null);
  if (!projectId) return { taskUrl: null, createdUrl: null };
  const createdUrl =
    c.op === "create_page" && text(ref.pageId)
      ? `${base}/pages/${ref.pageId}`
      : c.op === "update_page" && text(c.pageId)
        ? `${base}/pages/${c.pageId}`
        : c.op === "create_subtask" || c.op === "create_task"
          ? taskPath(text(ref.taskId))
          : c.op === "link_tasks"
            ? taskPath(text(c.targetTaskId))
            : null;
  return { taskUrl: taskPath(text(c.taskId)), createdUrl };
}

export type RunStatus = (typeof RUN_STATUSES)[number];

const runColumns = {
  id: aiRunTable.id,
  agentId: aiRunTable.agentId,
  agentName: agentTable.name,
  agentUserId: agentTable.userId,
  principalUserId: aiRunTable.principalUserId,
  principalName: userTable.name,
  taskId: aiRunTable.taskId,
  taskTitle: taskTable.title,
  taskNumber: taskTable.number,
  projectId: aiRunTable.projectId,
  projectSlug: projectTable.slug,
  projectName: projectTable.name,
  trigger: aiRunTable.trigger,
  triggerRef: aiRunTable.triggerRef,
  input: aiRunTable.input,
  status: aiRunTable.status,
  error: aiRunTable.error,
  outputSummary: aiRunTable.outputSummary,
  tokenIn: aiRunTable.tokenIn,
  tokenOut: aiRunTable.tokenOut,
  costMicros: aiRunTable.costMicros,
  toolCalls: aiRunTable.toolCalls,
  createdAt: aiRunTable.createdAt,
  startedAt: aiRunTable.startedAt,
  finishedAt: aiRunTable.finishedAt,
};

type AiRunTrigger = typeof aiRunTable.$inferSelect.trigger;

type RunRow = {
  [K in keyof typeof runColumns]: (typeof runColumns)[K]["_"]["data"] | null;
} & {
  id: string;
  createdAt: Date;
  status: RunStatus;
  trigger: AiRunTrigger;
};

function runQuery() {
  return db
    .select(runColumns)
    .from(aiRunTable)
    .leftJoin(agentTable, eq(agentTable.id, aiRunTable.agentId))
    .leftJoin(userTable, eq(userTable.id, aiRunTable.principalUserId))
    .leftJoin(taskTable, eq(taskTable.id, aiRunTable.taskId))
    .leftJoin(projectTable, eq(projectTable.id, aiRunTable.projectId));
}

async function counts(runIds: string[]) {
  if (runIds.length === 0)
    return new Map<string, { pending: number; applied: number }>();
  const [pending, applied] = await Promise.all([
    db
      .select({ runId: aiApprovalTable.runId, value: count() })
      .from(aiApprovalTable)
      .where(
        and(
          inArray(aiApprovalTable.runId, runIds),
          eq(aiApprovalTable.status, "pending"),
        ),
      )
      .groupBy(aiApprovalTable.runId),
    db
      .select({ runId: aiRunStepTable.runId, value: count() })
      .from(aiRunStepTable)
      .where(
        and(
          inArray(aiRunStepTable.runId, runIds),
          eq(aiRunStepTable.resultStatus, "applied"),
        ),
      )
      .groupBy(aiRunStepTable.runId),
  ]);
  const out = new Map<string, { pending: number; applied: number }>();
  for (const id of runIds) out.set(id, { pending: 0, applied: 0 });
  for (const row of pending) {
    const entry = out.get(row.runId);
    if (entry) entry.pending = Number(row.value);
  }
  for (const row of applied) {
    const entry = out.get(row.runId);
    if (entry) entry.applied = Number(row.value);
  }
  return out;
}

function serializeRun(
  row: RunRow,
  extra: { pending: number; applied: number },
  viewerId: string,
) {
  // The question is for the person the run works for; managers see that
  // the run waits, not what it asked.
  const asked =
    row.status === "needs_input" &&
    row.principalUserId === viewerId &&
    row.input?.question
      ? { text: row.input.question, options: row.input.options ?? [] }
      : null;
  return {
    id: row.id,
    agent: row.agentId
      ? {
          id: row.agentId,
          userId: row.agentUserId ?? "",
          name: row.agentName ?? "",
        }
      : null,
    principal: row.principalUserId
      ? { id: row.principalUserId, name: row.principalName ?? "" }
      : null,
    task: row.taskId
      ? {
          id: row.taskId,
          projectId: row.projectId ?? "",
          key: `${(row.projectSlug ?? "").toUpperCase()}-${row.taskNumber ?? 0}`,
          title: row.taskTitle ?? "",
        }
      : null,
    project: row.projectId
      ? {
          id: row.projectId,
          name: row.projectName ?? "",
          slug: row.projectSlug ?? "",
        }
      : null,
    trigger: row.trigger,
    followUpOf: row.triggerRef?.previousRunId ?? null,
    status: row.status,
    question: asked,
    // The person's own words, for them only. After the run ends it is
    // there only when the instance stores prompts.
    request:
      row.principalUserId === viewerId ? (row.input?.prompt ?? null) : null,
    error: row.error,
    outputSummary: row.outputSummary,
    tokenIn: row.tokenIn ?? 0,
    tokenOut: row.tokenOut ?? 0,
    costMicros: Number(row.costMicros ?? 0),
    toolCalls: row.toolCalls ?? 0,
    pendingApprovals: extra.pending,
    appliedChanges: extra.applied,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export async function listRuns(input: {
  workspaceId: string;
  userId: string;
  canManage: boolean;
  agentId?: string;
  taskId?: string;
  status?: RunStatus;
  before?: string;
  limit?: number;
}) {
  const hidden = await hiddenProjectIds(input.userId, input.workspaceId);
  const conditions: (SQL | undefined)[] = [
    eq(aiRunTable.workspaceId, input.workspaceId),
    input.canManage ? undefined : eq(aiRunTable.principalUserId, input.userId),
    input.agentId ? eq(aiRunTable.agentId, input.agentId) : undefined,
    input.taskId ? eq(aiRunTable.taskId, input.taskId) : undefined,
    input.status ? eq(aiRunTable.status, input.status) : undefined,
    input.before ? lt(aiRunTable.createdAt, new Date(input.before)) : undefined,
    hidden.length > 0 ? notInArray(aiRunTable.projectId, hidden) : undefined,
  ];
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const rows = (await runQuery()
    .where(and(...conditions))
    .orderBy(desc(aiRunTable.createdAt), desc(aiRunTable.id))
    .limit(limit)) as RunRow[];
  const extra = await counts(rows.map((row) => row.id));
  return rows.map((row) =>
    serializeRun(
      row,
      extra.get(row.id) ?? { pending: 0, applied: 0 },
      input.userId,
    ),
  );
}

async function readableRun(input: {
  workspaceId: string;
  runId: string;
  userId: string;
  canManage: boolean;
}): Promise<RunRow> {
  const [row] = (await runQuery()
    .where(
      and(
        eq(aiRunTable.id, input.runId),
        eq(aiRunTable.workspaceId, input.workspaceId),
      ),
    )
    .limit(1)) as RunRow[];
  const mine = row?.principalUserId === input.userId;
  if (
    !row ||
    (!mine && !input.canManage) ||
    (row.projectId && !(await canSeeProject(input.userId, row.projectId)))
  ) {
    throw new HTTPException(404, { message: "Run not found" });
  }
  return row;
}

export async function getRun(input: {
  workspaceId: string;
  runId: string;
  userId: string;
  canManage: boolean;
}) {
  const row = await readableRun(input);
  const [steps, approvals, extra] = await Promise.all([
    db
      .select()
      .from(aiRunStepTable)
      .where(eq(aiRunStepTable.runId, row.id))
      .orderBy(asc(aiRunStepTable.seq)),
    db.select().from(aiApprovalTable).where(eq(aiApprovalTable.runId, row.id)),
    counts([row.id]),
  ]);
  const mayUndo = row.principalUserId === input.userId || input.canManage;
  const approvalByStep = new Map(approvals.map((a) => [a.stepId, a]));
  return {
    ...serializeRun(
      row,
      extra.get(row.id) ?? { pending: 0, applied: 0 },
      input.userId,
    ),
    steps: steps.map((step) => {
      const approval = approvalByStep.get(step.id);
      return {
        id: step.id,
        seq: step.seq,
        kind: step.kind,
        toolName: step.toolName,
        risk: step.risk,
        args: step.args,
        status: step.resultStatus,
        reason:
          typeof step.resultRef?.reason === "string"
            ? (step.resultRef.reason as string)
            : null,
        change: step.change,
        text: step.outputText,
        links: changeLinks(input.workspaceId, step.change, step.resultRef),
        tokenIn: step.tokenIn,
        tokenOut: step.tokenOut,
        costMicros: Number(step.costMicros),
        appliedAt: step.appliedAt,
        revertedAt: step.revertedAt,
        canUndo:
          mayUndo &&
          step.resultStatus === "applied" &&
          Boolean(step.change) &&
          // Calls to outside services can't be taken back.
          step.change?.op !== "connector_call",
        approval: approval
          ? {
              id: approval.id,
              status: approval.status,
              expiresAt: approval.expiresAt,
              canDecide:
                approval.status === "pending" &&
                approval.requestedForUserId === input.userId,
            }
          : null,
        createdAt: step.createdAt,
      };
    }),
  };
}

/** Pending approvals waiting for this person (their inbox). */
export async function listMyApprovals(workspaceId: string, userId: string) {
  const hidden = await hiddenProjectIds(userId, workspaceId);
  const rows = await db
    .select({
      id: aiApprovalTable.id,
      runId: aiApprovalTable.runId,
      stepId: aiApprovalTable.stepId,
      toolName: aiApprovalTable.toolName,
      change: aiApprovalTable.argsPreview,
      createdAt: aiApprovalTable.createdAt,
      expiresAt: aiApprovalTable.expiresAt,
      agentId: agentTable.id,
      agentName: agentTable.name,
      agentUserId: agentTable.userId,
      projectId: aiRunTable.projectId,
    })
    .from(aiApprovalTable)
    .innerJoin(aiRunTable, eq(aiRunTable.id, aiApprovalTable.runId))
    .leftJoin(agentTable, eq(agentTable.id, aiRunTable.agentId))
    .where(
      and(
        eq(aiApprovalTable.workspaceId, workspaceId),
        eq(aiApprovalTable.requestedForUserId, userId),
        eq(aiApprovalTable.status, "pending"),
        hidden.length > 0
          ? notInArray(aiRunTable.projectId, hidden)
          : undefined,
      ),
    )
    .orderBy(desc(aiApprovalTable.createdAt))
    .limit(100);
  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    stepId: row.stepId,
    toolName: row.toolName,
    change: row.change,
    agent: row.agentId
      ? {
          id: row.agentId,
          userId: row.agentUserId ?? "",
          name: row.agentName ?? "",
        }
      : null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }));
}

type RunnableAgent = {
  id: string;
  enabled: boolean;
  monthlyBudgetMicros: number | null;
  projectIds: string[] | null;
};

/** The agent, when it exists in the workspace and is turned on. */
async function runnableAgent(
  workspaceId: string,
  agentId: string,
): Promise<RunnableAgent> {
  const [agent] = await db
    .select({
      id: agentTable.id,
      enabled: agentTable.enabled,
      monthlyBudgetMicros: agentTable.monthlyBudgetMicros,
      projectIds: agentTable.projectIds,
    })
    .from(agentTable)
    .where(
      and(eq(agentTable.id, agentId), eq(agentTable.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!agent) throw new HTTPException(404, { message: "Agent not found" });
  if (!agent.enabled) {
    throw new HTTPException(409, { message: "This agent is turned off" });
  }
  return agent;
}

/** The stable code of a run refused by the agent's project allow-list. */
export const OUTSIDE_AGENT_PROJECTS = "OUTSIDE_AGENT_PROJECTS";

function assertAgentProject(agent: RunnableAgent, projectId: string) {
  if (agent.projectIds && !agent.projectIds.includes(projectId)) {
    throw jsonHttpError(409, {
      code: OUTSIDE_AGENT_PROJECTS,
      message: "This agent isn't set up to work in this project",
    });
  }
}

/** Refuse up front rather than queue a run that can only fail. */
async function assertBudgets(
  agent: RunnableAgent,
  input: { workspaceId: string; userId: string },
) {
  if (
    agent.monthlyBudgetMicros !== null &&
    (await agentMonthSpendMicros(agent.id)) >= agent.monthlyBudgetMicros
  ) {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    throw new AiError(
      "AI_BUDGET_EXCEEDED",
      "This agent has used up its budget for this month",
      { retryAfterSeconds: Math.ceil((next - now.getTime()) / 1000) },
    );
  }
  await assertWithinBudget({
    workspaceId: input.workspaceId,
    userId: input.userId,
    policy: await loadWorkspaceAiPolicy(input.workspaceId),
  });
}

/** "Run agent" on a task the caller can see, in a project with AI on. */
export async function startManualRun(input: {
  workspaceId: string;
  agentId: string;
  taskId: string;
  userId: string;
  prompt: string;
}) {
  const agent = await runnableAgent(input.workspaceId, input.agentId);
  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      aiEnabled: projectTable.aiEnabled,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(taskTable.id, input.taskId),
        eq(projectTable.workspaceId, input.workspaceId),
        isNull(taskTable.deletedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!task || !(await canSeeProject(input.userId, task.projectId))) {
    throw new HTTPException(404, { message: "Task not found" });
  }
  if (!task.aiEnabled) {
    throw new HTTPException(403, {
      message: "AI is turned off for this project",
    });
  }
  assertAgentProject(agent, task.projectId);
  await assertBudgets(agent, input);
  const run = await enqueueRun({
    workspaceId: input.workspaceId,
    projectId: task.projectId,
    taskId: task.id,
    agentId: agent.id,
    principalUserId: input.userId,
    trigger: "manual",
    prompt: input.prompt,
  });
  if (!run) throw new HTTPException(409, { message: "Already queued" });
  return { id: run.id, status: run.status };
}

/** Cancels a queued or running run (its principal, or ai:manage). */
export async function cancelRun(input: {
  workspaceId: string;
  runId: string;
  userId: string;
  canManage: boolean;
}) {
  const row = await readableRun(input);
  const [updated] = await db
    .update(aiRunTable)
    .set({
      status: "cancelled",
      finishedAt: new Date(),
      lockedUntil: null,
      // A cancelled run keeps its request (and answers) only when the
      // instance stores prompts; an open question never stays. A running
      // run's worker can't finish it any more, so this is the last write.
      input: retainedInput(),
    })
    .where(
      and(
        eq(aiRunTable.id, row.id),
        inArray(aiRunTable.status, ["queued", "running", "needs_input"]),
      ),
    )
    .returning({ id: aiRunTable.id, status: aiRunTable.status });
  if (!updated) {
    throw new HTTPException(409, { message: "This run has already ended" });
  }
  return updated;
}

/**
 * Answers a run's question: only the person it asked, while it waits. The
 * same run is queued again with the answer and continues where it paused.
 */
export async function replyToRun(input: {
  workspaceId: string;
  runId: string;
  userId: string;
  canManage: boolean;
  text: string;
}) {
  const row = await readableRun(input);
  if (row.principalUserId !== input.userId) {
    throw new HTTPException(403, {
      message: "Only the person the agent asked can answer",
    });
  }
  const question = row.input?.question;
  if (row.status !== "needs_input" || !question) {
    throw new HTTPException(409, {
      message: "This run isn't waiting for an answer",
    });
  }
  const { question: _q, options: _o, askedAt, ...rest } = row.input ?? {};
  const [updated] = await db
    .update(aiRunTable)
    .set({
      status: "queued",
      lockedUntil: null,
      input: {
        ...rest,
        answers: [
          ...(rest.answers ?? []),
          { question, answer: input.text.trim() },
        ],
      },
    })
    .where(
      and(
        eq(aiRunTable.id, row.id),
        eq(aiRunTable.status, "needs_input"),
        // The answer belongs to this question, not a later one.
        sql`${aiRunTable.input}->>'askedAt' = ${askedAt ?? ""}`,
      ),
    )
    .returning();
  if (!updated) {
    throw new HTTPException(409, {
      message: "This run isn't waiting for an answer",
    });
  }
  await publishRunUpdated({
    workspaceId: updated.workspaceId,
    runId: updated.id,
    principalUserId: updated.principalUserId,
    taskId: updated.taskId,
    status: updated.status,
  });
  void kickAgentRunner();
  return { id: updated.id, status: updated.status };
}

/**
 * Chat with an agent: a follow-up to a finished run starts a new run of
 * the same agent, on the same task or project, with the earlier summary
 * as context. The caller must be able to read the earlier run.
 */
export async function followUpRun(input: {
  workspaceId: string;
  runId: string;
  userId: string;
  canManage: boolean;
  text: string;
}) {
  const row = await readableRun(input);
  if (!["succeeded", "failed", "cancelled"].includes(row.status)) {
    throw new HTTPException(409, {
      message: "Wait for this run to finish before following up",
    });
  }
  if (!row.agentId || !row.projectId) {
    throw new HTTPException(409, { message: "The agent was deleted" });
  }
  const agent = await runnableAgent(input.workspaceId, row.agentId);
  const [project] = await db
    .select({ aiEnabled: projectTable.aiEnabled })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, row.projectId),
        eq(projectTable.workspaceId, input.workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!project || !(await canSeeProject(input.userId, row.projectId))) {
    throw new HTTPException(404, { message: "Run not found" });
  }
  if (!project.aiEnabled) {
    throw new HTTPException(403, {
      message: "AI is turned off for this project",
    });
  }
  assertAgentProject(agent, row.projectId);
  await assertBudgets(agent, input);
  const run = await enqueueRun({
    workspaceId: input.workspaceId,
    projectId: row.projectId,
    taskId: row.taskId,
    agentId: agent.id,
    principalUserId: input.userId,
    trigger: "chat",
    triggerRef: { previousRunId: row.id },
    prompt: input.text.trim(),
    context: row.outputSummary,
  });
  if (!run) throw new HTTPException(409, { message: "Already queued" });
  return { id: run.id, status: run.status };
}
