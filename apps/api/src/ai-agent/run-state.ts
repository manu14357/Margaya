import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import db from "../database";
import {
  aiApprovalTable,
  aiRunStepTable,
  aiRunTable,
} from "../database/schema";
import { type Change, describeChange } from "./changes";
import { publishRunUpdated } from "./events";

// Run state transitions shared by the runner, the runtime and approvals.

export type AiRunRow = typeof aiRunTable.$inferSelect;

/** This worker still owns the run: running, and not reclaimed since. */
export function ownedBy(row: Pick<AiRunRow, "id" | "attemptCount">) {
  return and(
    eq(aiRunTable.id, row.id),
    eq(aiRunTable.status, "running"),
    eq(aiRunTable.attemptCount, row.attemptCount),
  );
}

/** Ends a run this worker owns (no-op when it was cancelled meanwhile). */
export async function finishRun(
  row: AiRunRow,
  result: {
    status: "succeeded" | "failed" | "awaiting_approval" | "cancelled";
    error?: string | null;
    outputSummary?: string | null;
  },
) {
  const [updated] = await db
    .update(aiRunTable)
    .set({
      status: result.status,
      error: result.error ?? null,
      outputSummary: result.outputSummary ?? null,
      lockedUntil: null,
      finishedAt: new Date(),
      apiKeyId: null,
      // A manual run's prompt is needed only while the run executes.
      input: null,
    })
    .where(ownedBy(row))
    .returning();
  if (updated) {
    await publishRunUpdated({
      workspaceId: updated.workspaceId,
      runId: updated.id,
      principalUserId: updated.principalUserId,
      taskId: updated.taskId,
      status: updated.status,
    });
  }
  return updated ?? null;
}

/**
 * Pauses a run this worker owns until its person answers the agent's
 * question. The input keeps the request, the question and the answers so
 * far; the run is resumed by queueing it again (desk.replyToRun).
 */
export async function pauseRun(
  row: AiRunRow,
  input: {
    question: string;
    options: string[];
    outputSummary?: string | null;
    now?: Date;
  },
) {
  const [updated] = await db
    .update(aiRunTable)
    .set({
      status: "needs_input",
      lockedUntil: null,
      apiKeyId: null,
      outputSummary: input.outputSummary ?? null,
      input: {
        ...(row.input ?? {}),
        question: input.question,
        options: input.options,
        askedAt: (input.now ?? new Date()).toISOString(),
      },
    })
    .where(ownedBy(row))
    .returning();
  if (updated) {
    await publishRunUpdated({
      workspaceId: updated.workspaceId,
      runId: updated.id,
      principalUserId: updated.principalUserId,
      taskId: updated.taskId,
      status: updated.status,
    });
  }
  return updated ?? null;
}

const MAX_LISTED = 5;

function listed(labels: string[]): string {
  const shown = labels.slice(0, MAX_LISTED).join("; ");
  return labels.length > MAX_LISTED
    ? `${shown}; and ${labels.length - MAX_LISTED} more`
    : shown;
}

export type DecidedChange = {
  status: "approved" | "rejected" | "expired";
  label: string;
};

/**
 * Margaya's own factual line about a run's held changes once all are
 * decided ("Approved: …. Rejected: …."), appended to the model's summary,
 * which was written while they still waited.
 */
export function decisionLine(decided: DecidedChange[]): string {
  const of = (status: DecidedChange["status"]) =>
    decided.filter((d) => d.status === status).map((d) => d.label);
  const groups: [string, string[]][] = [
    ["Approved", of("approved")],
    ["Rejected", of("rejected")],
    ["Expired without a decision", of("expired")],
  ];
  return groups
    .filter(([, labels]) => labels.length > 0)
    .map(([title, labels]) => `${title}: ${listed(labels)}.`)
    .join(" ");
}

/**
 * How a run ends once none of its held changes waits any more: it
 * succeeded when it changed something (approved, or applied directly),
 * was cancelled when the person rejected everything it proposed, and
 * failed when its proposals expired undecided.
 */
export function settledStatus(input: {
  decided: DecidedChange[];
  appliedSteps: number;
}): { status: "succeeded" | "cancelled" | "failed"; error: string | null } {
  if (input.appliedSteps > 0) return { status: "succeeded", error: null };
  if (input.decided.some((d) => d.status === "rejected")) {
    return { status: "cancelled", error: null };
  }
  if (input.decided.some((d) => d.status === "expired")) {
    return { status: "failed", error: "APPROVAL_EXPIRED" };
  }
  return { status: "succeeded", error: null };
}

/**
 * Ends a run waiting for approvals once none is pending any more, with a
 * status and summary that say what was decided. Returns the run's status
 * after the check.
 */
export async function settleRun(runId: string): Promise<string | null> {
  const [current] = await db
    .select({
      status: aiRunTable.status,
      outputSummary: aiRunTable.outputSummary,
      error: aiRunTable.error,
    })
    .from(aiRunTable)
    .where(eq(aiRunTable.id, runId))
    .limit(1);
  if (current?.status !== "awaiting_approval") return current?.status ?? null;

  const approvals = await db
    .select({
      status: aiApprovalTable.status,
      change: aiRunStepTable.change,
      toolName: aiApprovalTable.toolName,
    })
    .from(aiApprovalTable)
    .innerJoin(aiRunStepTable, eq(aiRunStepTable.id, aiApprovalTable.stepId))
    .where(eq(aiApprovalTable.runId, runId))
    .orderBy(asc(aiRunStepTable.seq));
  if (approvals.some((a) => a.status === "pending")) return current.status;
  const decided = approvals.flatMap((a): DecidedChange[] =>
    a.status === "approved" || a.status === "rejected" || a.status === "expired"
      ? [
          {
            status: a.status,
            label: a.change
              ? describeChange(a.change as unknown as Change)
              : a.toolName,
          },
        ]
      : [],
  );
  const [{ applied } = { applied: 0 }] = await db
    .select({ applied: count() })
    .from(aiRunStepTable)
    .where(
      and(
        eq(aiRunStepTable.runId, runId),
        inArray(aiRunStepTable.resultStatus, ["applied", "reverted"]),
      ),
    );
  const outcome = settledStatus({ decided, appliedSteps: Number(applied) });
  const line = decisionLine(decided);
  const summary = [current.outputSummary?.trim(), line]
    .filter(Boolean)
    .join("\n\n");

  const [row] = await db
    .update(aiRunTable)
    .set({
      status: outcome.status,
      // A run that stopped early (INTERRUPTED, TURN_LIMIT…) keeps its code.
      error: outcome.error ?? current.error,
      outputSummary: summary.slice(0, 2_000) || null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(aiRunTable.id, runId),
        eq(aiRunTable.status, "awaiting_approval"),
        sql`not exists (select 1 from ${aiApprovalTable} where ${aiApprovalTable.runId} = ${aiRunTable.id} and ${aiApprovalTable.status} = 'pending')`,
      ),
    )
    .returning();
  if (row) {
    await publishRunUpdated({
      workspaceId: row.workspaceId,
      runId: row.id,
      principalUserId: row.principalUserId,
      taskId: row.taskId,
      status: row.status,
    });
    return row.status;
  }
  const [after] = await db
    .select({ status: aiRunTable.status })
    .from(aiRunTable)
    .where(eq(aiRunTable.id, runId))
    .limit(1);
  return after?.status ?? null;
}
