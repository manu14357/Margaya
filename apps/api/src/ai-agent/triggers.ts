import { and, eq, inArray } from "drizzle-orm";
import { getAiInstanceConfig } from "../ai/instance-config";
import { loadWorkspaceAiPolicy } from "../ai/workspace-settings";
import db from "../database";
import { agentTable, projectTable, userTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import { parseMentionIds } from "../utils/parse-mentions";
import { enqueueRun } from "./runner";

// Event subscribers that only enqueue (report 02, G9): an @mention of an
// agent in a comment, or assigning a task to an agent, queues a run whose
// principal is the person who did it. Nothing happens unless AI is on for
// the instance, the workspace and the project, and agents never trigger
// agents (no loops).

type TaskSource = {
  workspaceId: string;
  projectId: string;
  aiEnabled: boolean;
};

async function taskSource(projectId: string): Promise<TaskSource | null> {
  const [row] = await db
    .select({
      workspaceId: projectTable.workspaceId,
      projectId: projectTable.id,
      aiEnabled: projectTable.aiEnabled,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return row ?? null;
}

async function aiOn(source: TaskSource | null): Promise<boolean> {
  if (!source?.aiEnabled || !getAiInstanceConfig().enabled) return false;
  return (await loadWorkspaceAiPolicy(source.workspaceId)).enabled;
}

async function isHuman(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const [row] = await db
    .select({ kind: userTable.kind })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.kind === "human";
}

/** Enabled agents of the workspace among these user ids. */
async function agentsAmong(workspaceId: string, userIds: string[]) {
  if (userIds.length === 0) return [];
  return db
    .select({ id: agentTable.id, userId: agentTable.userId })
    .from(agentTable)
    .where(
      and(
        eq(agentTable.workspaceId, workspaceId),
        eq(agentTable.enabled, true),
        inArray(agentTable.userId, userIds),
      ),
    );
}

export async function onCommentCreated(data: {
  id: string;
  taskId: string;
  userId: string | null;
  content: string | null;
  projectId: string;
  origin?: string;
}) {
  if (data.origin && data.origin !== "app") return;
  const mentioned = parseMentionIds(data.content);
  if (mentioned.length === 0 || !data.userId) return;
  const source = await taskSource(data.projectId);
  if (!source || !(await aiOn(source))) return;
  const agents = await agentsAmong(source.workspaceId, mentioned);
  if (agents.length === 0 || !(await isHuman(data.userId))) return;
  for (const agent of agents) {
    await enqueueRun({
      workspaceId: source.workspaceId,
      projectId: source.projectId,
      taskId: data.taskId,
      agentId: agent.id,
      principalUserId: data.userId,
      trigger: "mention",
      triggerRef: { commentId: data.id },
      dedupeKey: `mention:${data.id}:${agent.id}`,
    });
  }
}

export async function onAssigned(data: {
  taskId: string;
  projectId: string;
  userId?: string;
  newAssigneeId: string;
}) {
  if (!data.userId || data.userId === data.newAssigneeId) return;
  const source = await taskSource(data.projectId);
  if (!source || !(await aiOn(source))) return;
  const [agent] = await agentsAmong(source.workspaceId, [data.newAssigneeId]);
  if (!agent || !(await isHuman(data.userId))) return;
  await enqueueRun({
    workspaceId: source.workspaceId,
    projectId: source.projectId,
    taskId: data.taskId,
    agentId: agent.id,
    principalUserId: data.userId,
    trigger: "assign",
    triggerRef: { taskId: data.taskId },
  });
}

/** A task created already assigned to agents (or given one by default). */
export async function onTaskCreated(data: {
  taskId?: string;
  projectId?: string;
  assigneeIds?: string[] | null;
  currentUserId?: string | null;
}) {
  if (!data.taskId || !data.projectId || !data.currentUserId) return;
  for (const assigneeId of data.assigneeIds ?? []) {
    await onAssigned({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.currentUserId,
      newAssigneeId: assigneeId,
    });
  }
}

/**
 * The automation action "run_agent": queues a run on the task for the
 * person who last saved the rule. The engine never calls it for changes an
 * agent made (automation-rule/engine.ts), so agents can't start agents.
 */
export async function enqueueAutomationRun(input: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  agentId: string;
  principalUserId: string;
  ruleId: string | null;
  prompt: string;
}): Promise<"QUEUED" | "AGENT_UNAVAILABLE" | "AI_DISABLED"> {
  const source = await taskSource(input.projectId);
  if (!source || !(await aiOn(source))) return "AI_DISABLED";
  const [agent] = await db
    .select({ id: agentTable.id })
    .from(agentTable)
    .where(
      and(
        eq(agentTable.id, input.agentId),
        eq(agentTable.workspaceId, input.workspaceId),
        eq(agentTable.enabled, true),
      ),
    )
    .limit(1);
  if (!agent || !(await isHuman(input.principalUserId))) {
    return "AGENT_UNAVAILABLE";
  }
  await enqueueRun({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.taskId,
    agentId: agent.id,
    principalUserId: input.principalUserId,
    trigger: "automation",
    triggerRef: input.ruleId ? { ruleId: input.ruleId } : undefined,
    prompt: input.prompt,
  });
  return "QUEUED";
}

subscribeToEvent("comment.created", onCommentCreated);
subscribeToEvent("task.assignee_changed", onAssigned);
subscribeToEvent("task.created", onTaskCreated);
