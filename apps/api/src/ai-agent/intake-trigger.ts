import { and, count, eq, gte } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { isAiError } from "../ai/errors";
import { getAiInstanceConfig } from "../ai/instance-config";
import { assertWithinBudget } from "../ai/usage";
import { loadWorkspaceAiPolicy } from "../ai/workspace-settings";
import { recordAudit } from "../audit-log/record";
import db from "../database";
import { agentTable, aiRunTable, projectTable } from "../database/schema";
import { jsonHttpError } from "../estimate/write";
import { publishEvent } from "../events";
import type { IntakeItemCreatedEvent } from "../intake/events";
import {
  type AgentRow,
  agentMonthSpendMicros,
  getAgent,
  serializeAgent,
} from "./identity";
import {
  cappedStatements,
  memberStatements,
  principalProjectAllows,
  satisfies,
  userKind,
} from "./rights";
import { enqueueRun } from "./runner";

// The intake trigger (plan C2): an agent can run on every new intake
// request in its projects, typically to triage it. Like a schedule, the
// runs act for the person who turned it on, capped at the agent's role and
// their rights, and the trigger turns itself off when that person leaves or
// loses ai:use or intake:read. Agents never trigger agents: a request an
// agent filed starts nothing. A request from outside the workspace (a
// public board, a form, no signed-in member) holds every write for
// approval, since its text was written by someone with no rights here.

/** Intake runs one agent may start per hour; the rest are skipped. */
export const INTAKE_RUNS_PER_HOUR = 30;

/** What the trigger's person needs; the agent's role must allow it too. */
const NEEDED = { ai: ["use"], intake: ["read"] };

export async function setIntakeTrigger(input: {
  workspaceId: string;
  agentId: string;
  userId: string;
  enabled: boolean;
  prompt?: string | null;
}) {
  const agent = await getAgent(input.workspaceId, input.agentId);
  const prompt =
    input.prompt === undefined
      ? agent.intakeTriggerPrompt
      : input.prompt?.trim() || null;
  if (input.enabled) {
    const rights = await memberStatements(input.workspaceId, input.userId);
    if (!rights || !satisfies(rights, NEEDED)) {
      throw new HTTPException(403, {
        message: "Intake runs act for you, so you need ai:use and intake:read",
      });
    }
    const capped = await cappedStatements({
      workspaceId: input.workspaceId,
      agentUserId: agent.userId,
      principalUserId: input.userId,
    });
    if (!satisfies(capped, { intake: ["read"], task: ["read"] })) {
      throw jsonHttpError(400, {
        code: "AGENT_CANT_READ_INTAKE",
        message: "enabled: this agent's role can't read intake requests",
      });
    }
  }
  await db
    .update(agentTable)
    .set({
      intakeTriggerEnabled: input.enabled,
      intakeTriggerPrompt: prompt,
      // Whoever turns it on vouches for it: the runs act for them.
      ...(input.enabled ? { intakeTriggerBy: input.userId } : {}),
    })
    .where(eq(agentTable.id, agent.id));
  await recordAudit({
    workspaceId: input.workspaceId,
    action: "agent.intake_trigger_updated",
    target: { type: "agent", id: agent.id, label: agent.name },
    // Never the prompt text itself.
    metadata: { enabled: input.enabled, customPrompt: prompt !== null },
  });
  await publishEvent("agent.changed", { workspaceId: input.workspaceId });
  const updated = await getAgent(input.workspaceId, agent.id);
  return serializeAgent(updated, await agentMonthSpendMicros(agent.id), true);
}

/** Turns an agent's intake trigger off for good, with the reason. */
async function disableIntakeTrigger(agent: AgentRow, reason: string) {
  const [updated] = await db
    .update(agentTable)
    .set({ intakeTriggerEnabled: false })
    .where(
      and(
        eq(agentTable.id, agent.id),
        eq(agentTable.intakeTriggerEnabled, true),
      ),
    )
    .returning({ id: agentTable.id });
  if (!updated) return;
  await recordAudit({
    workspaceId: agent.workspaceId,
    action: "agent.intake_trigger_disabled",
    target: { type: "agent", id: agent.id, label: agent.name },
    metadata: { reason },
  });
  await publishEvent("agent.changed", { workspaceId: agent.workspaceId });
}

async function intakeRunsLastHour(agentId: string, now: Date) {
  const [row] = await db
    .select({ value: count() })
    .from(aiRunTable)
    .where(
      and(
        eq(aiRunTable.agentId, agentId),
        eq(aiRunTable.trigger, "intake"),
        gte(aiRunTable.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    );
  return Number(row?.value ?? 0);
}

/** Why this agent shouldn't run on this request now; null when it may. */
async function skipReason(
  agent: AgentRow,
  projectId: string,
  now: Date,
): Promise<{ reason: string; disable: boolean } | null> {
  if (agent.projectIds && !agent.projectIds.includes(projectId)) {
    return { reason: "OUTSIDE_AGENT_PROJECTS", disable: false };
  }
  const principal = agent.intakeTriggerBy;
  if (!principal) return { reason: "PRINCIPAL_LEFT", disable: true };
  const rights = await memberStatements(agent.workspaceId, principal);
  if (!rights) return { reason: "PRINCIPAL_LEFT", disable: true };
  if (!satisfies(rights, { ai: ["use"] })) {
    return { reason: "AI_USE_DENIED", disable: true };
  }
  if (!satisfies(rights, { intake: ["read"] })) {
    return { reason: "INTAKE_READ_DENIED", disable: true };
  }
  // A restricted project the person can't see (or can't read intake in)
  // is out of reach for this request only.
  if (
    !(await principalProjectAllows(
      agent.workspaceId,
      principal,
      projectId,
      NEEDED,
    ))
  ) {
    return { reason: "NOT_IN_SCOPE", disable: false };
  }
  const capped = await cappedStatements({
    workspaceId: agent.workspaceId,
    agentUserId: agent.userId,
    principalUserId: principal,
  }).catch(() => null);
  if (!capped || !satisfies(capped, { intake: ["read"], task: ["read"] })) {
    return { reason: "NOT_ALLOWED", disable: false };
  }
  if ((await intakeRunsLastHour(agent.id, now)) >= INTAKE_RUNS_PER_HOUR) {
    return { reason: "RATE_LIMITED", disable: false };
  }
  if (
    agent.monthlyBudgetMicros !== null &&
    (await agentMonthSpendMicros(agent.id)) >= agent.monthlyBudgetMicros
  ) {
    return { reason: "AI_BUDGET_EXCEEDED", disable: false };
  }
  try {
    await assertWithinBudget({
      workspaceId: agent.workspaceId,
      userId: principal,
      policy: await loadWorkspaceAiPolicy(agent.workspaceId),
    });
  } catch (error) {
    if (isAiError(error)) return { reason: error.code, disable: false };
    throw error;
  }
  return null;
}

/**
 * intake.item_created: queues one run per enabled agent with the intake
 * trigger on. Nothing happens unless AI is on for the instance, the
 * workspace and the project.
 */
export async function onIntakeItemCreated(
  event: IntakeItemCreatedEvent,
  now: Date = new Date(),
) {
  if (!getAiInstanceConfig().enabled) return;
  // Agents never start agents.
  if (event.userId && (await userKind(event.userId)) !== "human") return;
  const [project] = await db
    .select({
      workspaceId: projectTable.workspaceId,
      aiEnabled: projectTable.aiEnabled,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(eq(projectTable.id, event.projectId))
    .limit(1);
  if (!project?.aiEnabled || project.deletedAt) return;
  if (!(await loadWorkspaceAiPolicy(project.workspaceId)).enabled) return;
  const agents = await db
    .select({ id: agentTable.id })
    .from(agentTable)
    .where(
      and(
        eq(agentTable.workspaceId, project.workspaceId),
        eq(agentTable.enabled, true),
        eq(agentTable.intakeTriggerEnabled, true),
      ),
    );
  if (agents.length === 0) return;
  // Someone with no rights here wrote the request: writes wait for approval.
  const outside =
    !event.userId ||
    !(await memberStatements(project.workspaceId, event.userId));
  for (const { id } of agents) {
    const agent = await getAgent(project.workspaceId, id).catch(() => null);
    if (!agent?.intakeTriggerEnabled) continue;
    const skip = await skipReason(agent, event.projectId, now);
    if (skip) {
      if (skip.disable) await disableIntakeTrigger(agent, skip.reason);
      continue;
    }
    await enqueueRun({
      workspaceId: project.workspaceId,
      projectId: event.projectId,
      taskId: event.taskId,
      agentId: agent.id,
      principalUserId: agent.intakeTriggerBy as string,
      trigger: "intake",
      triggerRef: {
        intakeItemId: event.intakeItemId,
        ...(outside ? { origin: "outside" } : {}),
      },
      dedupeKey: `intake:${event.intakeItemId}:${agent.id}`,
      prompt: agent.intakeTriggerPrompt,
    });
  }
}
