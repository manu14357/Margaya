import { and, eq, gt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { resolveAiScopeFor } from "../ai/context";
import { recordAudit } from "../audit-log/record";
import db from "../database";
import {
  aiApprovalTable,
  aiRunStepTable,
  aiRunTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { notifySystem } from "../notification/system";
import { hiddenProjectIds } from "../project/visibility";
import {
  type AppliedRef,
  applyChange,
  type Change,
  ChangeError,
  changePermissions,
  describeChange,
  undoChange,
} from "./changes";
import { withRunKey } from "./credential";
import { type AgentRow, getAgent } from "./identity";
import {
  cappedStatements,
  principalProjectAllows,
  RightsError,
  satisfies,
} from "./rights";
import { type AiRunRow, settleRun } from "./run-state";

// Agent Desk decisions: approving or rejecting a held change, and undoing
// an applied one. Each runs through the API with a fresh short-lived key
// whose rights are the agent's role ∩ the deciding person's, so neither an
// approval nor an undo can do more than that person could.

export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/** Holds a change for the run's principal and tells them in the inbox. */
export async function createApproval(input: {
  run: AiRunRow;
  agent: AgentRow;
  stepId: string;
  toolName: string;
  change: Change;
}) {
  const principal = input.run.principalUserId;
  if (!principal) throw new Error("A run without a principal");
  const [approval] = await db
    .insert(aiApprovalTable)
    .values({
      runId: input.run.id,
      stepId: input.stepId,
      workspaceId: input.run.workspaceId,
      requestedForUserId: principal,
      toolName: input.toolName,
      argsPreview: input.change as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    })
    .returning();
  if (!approval) throw new Error("Could not create an approval");
  const taskId =
    input.change.op === "bulk_set_status"
      ? input.change.items[0]?.taskId
      : input.change.taskId;
  await notifySystem({
    userId: principal,
    type: "ai_approval_requested",
    title: `${input.agent.name} needs your approval`,
    content: describeChange(input.change),
    // A project page or an outside call may have no task: the workspace.
    ...((taskId ?? input.run.taskId)
      ? {
          resourceId: (taskId ?? input.run.taskId) as string,
          resourceType: "task",
        }
      : { resourceId: input.run.workspaceId, resourceType: "workspace" }),
    actorId: input.agent.userId,
    eventData: {
      approvalId: approval.id,
      runId: input.run.id,
      agentId: input.agent.id,
      agentName: input.agent.name,
      tool: input.toolName,
      op: input.change.op,
    },
  });
  await publishEvent("ai.approval_requested", {
    workspaceId: input.run.workspaceId,
    userId: principal,
  });
  return approval;
}

async function loadApproval(workspaceId: string, approvalId: string) {
  const [row] = await db
    .select({
      approval: aiApprovalTable,
      step: aiRunStepTable,
      run: aiRunTable,
    })
    .from(aiApprovalTable)
    .innerJoin(aiRunStepTable, eq(aiRunStepTable.id, aiApprovalTable.stepId))
    .innerJoin(aiRunTable, eq(aiRunTable.id, aiApprovalTable.runId))
    .where(
      and(
        eq(aiApprovalTable.id, approvalId),
        eq(aiApprovalTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Approval not found" });
  return row;
}

/**
 * Runs a change (or its undo) as the agent with `userId`'s rights, after
 * checking the project is still within both their reach.
 */
async function asAgentFor<T>(input: {
  run: AiRunRow;
  agent: AgentRow;
  userId: string;
  change: Change;
  direction: "apply" | "undo";
  work: Parameters<typeof withRunKey<T>>[1];
}): Promise<T> {
  const statements = await cappedStatements({
    workspaceId: input.run.workspaceId,
    agentUserId: input.agent.userId,
    principalUserId: input.userId,
  }).catch((error) => {
    if (error instanceof RightsError) {
      throw new HTTPException(403, { message: "Not allowed" });
    }
    throw error;
  });
  const required = changePermissions(input.change, input.direction);
  const projectId = input.change.projectId;
  const scope = await resolveAiScopeFor({
    workspaceId: input.run.workspaceId,
    userId: input.userId,
    can: (permissions) => satisfies(statements, permissions),
  });
  const agentHidden = await hiddenProjectIds(
    input.agent.userId,
    input.run.workspaceId,
  );
  if (
    !scope.projectIds.has(projectId) ||
    agentHidden.includes(projectId) ||
    !satisfies(statements, required) ||
    !(await principalProjectAllows(
      input.run.workspaceId,
      input.userId,
      projectId,
      required,
    ))
  ) {
    throw new HTTPException(403, {
      message: "You or the agent can no longer make this change",
    });
  }
  return withRunKey(
    {
      runId: input.run.id,
      agentUserId: input.agent.userId,
      onBehalfOf: input.userId,
      statements,
      projectIds: [projectId],
      ttlMs: 2 * 60 * 1000,
    },
    input.work,
  );
}

function changeError(error: unknown): never {
  if (error instanceof ChangeError) {
    throw new HTTPException(
      error.status === 404 ? 409 : error.status >= 500 ? 502 : 409,
      {
        message: error.message,
      },
    );
  }
  throw error;
}

/**
 * Approve or reject a held change. Only the person it waits for decides;
 * an expired approval can't be decided.
 */
export async function decideApproval(input: {
  workspaceId: string;
  approvalId: string;
  userId: string;
  decision: "approve" | "reject";
}) {
  const row = await loadApproval(input.workspaceId, input.approvalId);
  if (row.approval.requestedForUserId !== input.userId) {
    throw new HTTPException(403, {
      message: "Only the person who asked the agent can decide",
    });
  }
  // Claim the decision atomically: a double click decides once.
  const [claimed] = await db
    .update(aiApprovalTable)
    .set({
      status: input.decision === "approve" ? "approved" : "rejected",
      decidedBy: input.userId,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(aiApprovalTable.id, input.approvalId),
        eq(aiApprovalTable.status, "pending"),
        gt(aiApprovalTable.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!claimed) {
    throw new HTTPException(409, {
      message: "This approval was already decided or has expired",
    });
  }

  const change = row.step.change as unknown as Change;
  if (input.decision === "reject") {
    await db
      .update(aiRunStepTable)
      .set({ resultStatus: "rejected" })
      .where(eq(aiRunStepTable.id, row.step.id));
    await recordAudit({
      workspaceId: input.workspaceId,
      action: "agent.change_rejected",
      target: {
        type: "agent_run",
        id: row.run.id,
        label: describeChange(change),
      },
      metadata: { projectId: change.projectId, tool: row.approval.toolName },
    });
  } else {
    try {
      if (!row.run.agentId) {
        throw new HTTPException(409, { message: "The agent was deleted" });
      }
      const agent = await getAgent(input.workspaceId, row.run.agentId);
      const ref = await asAgentFor<AppliedRef>({
        run: row.run,
        agent,
        userId: input.userId,
        change,
        direction: "apply",
        work: (api) => applyChange(api, change).catch(changeError),
      });
      await db
        .update(aiRunStepTable)
        .set({ resultStatus: "applied", resultRef: ref, appliedAt: new Date() })
        .where(eq(aiRunStepTable.id, row.step.id));
      await recordAudit({
        workspaceId: input.workspaceId,
        action: "agent.change_approved",
        target: {
          type: "agent_run",
          id: row.run.id,
          label: describeChange(change),
        },
        metadata: {
          projectId: change.projectId,
          tool: row.approval.toolName,
          agentId: agent.id,
          aiRunId: row.run.id,
        },
      });
    } catch (error) {
      // Applying failed: the approval goes back to pending so it can be
      // retried or rejected, unless it expired meanwhile.
      await db
        .update(aiApprovalTable)
        .set({ status: "pending", decidedBy: null, decidedAt: null })
        .where(eq(aiApprovalTable.id, input.approvalId));
      throw error;
    }
  }
  await settleRun(row.run.id);
  await publishEvent("ai.approval_requested", {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  return { id: input.approvalId, status: claimed.status };
}

/**
 * Reverts an applied change. The run's principal or anyone with ai:manage
 * may undo; the undo runs with the agent's role ∩ their rights.
 */
export async function undoStep(input: {
  workspaceId: string;
  stepId: string;
  userId: string;
  canManage: boolean;
}) {
  const [row] = await db
    .select({ step: aiRunStepTable, run: aiRunTable })
    .from(aiRunStepTable)
    .innerJoin(aiRunTable, eq(aiRunTable.id, aiRunStepTable.runId))
    .where(
      and(
        eq(aiRunStepTable.id, input.stepId),
        eq(aiRunTable.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Change not found" });
  if (row.run.principalUserId !== input.userId && !input.canManage) {
    throw new HTTPException(403, {
      message: "Only the person who asked the agent can undo its changes",
    });
  }
  if (row.step.resultStatus !== "applied" || !row.step.change) {
    throw new HTTPException(409, {
      message: "Only applied changes can be undone",
    });
  }
  if (!row.run.agentId) {
    throw new HTTPException(409, { message: "The agent was deleted" });
  }
  // Claim the undo first so two clicks can't revert twice.
  const [claimed] = await db
    .update(aiRunStepTable)
    .set({
      resultStatus: "reverted",
      revertedAt: new Date(),
      revertedBy: input.userId,
    })
    .where(
      and(
        eq(aiRunStepTable.id, input.stepId),
        eq(aiRunStepTable.resultStatus, "applied"),
      ),
    )
    .returning();
  if (!claimed) {
    throw new HTTPException(409, { message: "This change was already undone" });
  }
  const change = row.step.change as unknown as Change;
  try {
    const agent = await getAgent(input.workspaceId, row.run.agentId);
    await asAgentFor({
      run: row.run,
      agent,
      userId: input.userId,
      change,
      direction: "undo",
      work: (api) =>
        undoChange(api, change, (row.step.resultRef ?? {}) as AppliedRef).catch(
          changeError,
        ),
    });
  } catch (error) {
    await db
      .update(aiRunStepTable)
      .set({ resultStatus: "applied", revertedAt: null, revertedBy: null })
      .where(eq(aiRunStepTable.id, input.stepId));
    throw error;
  }
  await recordAudit({
    workspaceId: input.workspaceId,
    action: "agent.change_reverted",
    target: {
      type: "agent_run",
      id: row.run.id,
      label: describeChange(change),
    },
    metadata: { projectId: change.projectId, tool: row.step.toolName },
  });
  await publishEvent("ai.run_updated", {
    workspaceId: row.run.workspaceId,
    runId: row.run.id,
    principalUserId: row.run.principalUserId,
    taskId: row.run.taskId,
    status: row.run.status,
  });
  return { id: input.stepId, status: "reverted" as const };
}
