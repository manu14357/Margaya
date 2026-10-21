import * as Sentry from "@sentry/node";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { auditContext } from "../audit-log/context";
import db from "../database";
import {
  aiApprovalTable,
  aiRunStepTable,
  aiRunTable,
} from "../database/schema";
import { eventContext } from "../events";
import { publishRunUpdated } from "./events";
import { type AiRunRow, finishRun, ownedBy, settleRun } from "./run-state";
import { executeRun } from "./runtime";

export type { AiRunRow };

// The agent run queue: ai_run rows claimed with FOR UPDATE SKIP LOCKED under
// a lease a heartbeat extends, the same shape as the export runner. Any
// number of API instances share it without Redis or a leader, and two
// workers can never claim the same run. `maintainAgentRuns` (every minute)
// requeues runs a crash left behind and expires stale approvals.

const LEASE_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
export const MAX_RUN_ATTEMPTS = 3;
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
/** An unanswered question fails its run after this long. */
export const NEEDS_INPUT_TTL_MS = 24 * 60 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export type RunTrigger = AiRunRow["trigger"];

export type EnqueueInput = {
  workspaceId: string;
  projectId: string;
  /** Null: a project-level run (schedules, follow-ups without a task). */
  taskId: string | null;
  agentId: string;
  principalUserId: string;
  trigger: RunTrigger;
  triggerRef?: Record<string, string>;
  /** One run per key: a repeated trigger is ignored. */
  dedupeKey?: string | null;
  prompt?: string | null;
  /** A follow-up run: the earlier run's summary. */
  context?: string | null;
};

/** Queues a run; null when the dedupe key already has one. */
export async function enqueueRun(
  input: EnqueueInput,
): Promise<AiRunRow | null> {
  const [row] = await db
    .insert(aiRunTable)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      agentId: input.agentId,
      principalUserId: input.principalUserId,
      trigger: input.trigger,
      triggerRef: input.triggerRef ?? null,
      dedupeKey: input.dedupeKey ?? null,
      input:
        input.prompt || input.context
          ? {
              ...(input.prompt ? { prompt: input.prompt } : {}),
              ...(input.context ? { context: input.context } : {}),
            }
          : null,
    })
    .onConflictDoNothing({ target: aiRunTable.dedupeKey })
    .returning();
  if (!row) return null;
  await publishRunUpdated({
    workspaceId: row.workspaceId,
    runId: row.id,
    principalUserId: row.principalUserId,
    taskId: row.taskId,
    status: row.status,
  });
  void kickAgentRunner();
  return row;
}

/** Claims the oldest queued run, or null when the queue is empty. */
export async function claimNextRun(
  now: Date = new Date(),
): Promise<AiRunRow | null> {
  return db.transaction(async (tx) => {
    const [next] = await tx
      .select({ id: aiRunTable.id, attempts: aiRunTable.attemptCount })
      .from(aiRunTable)
      .where(eq(aiRunTable.status, "queued"))
      .orderBy(asc(aiRunTable.createdAt), asc(aiRunTable.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    const [claimed] = await tx
      .update(aiRunTable)
      .set({
        status: "running",
        startedAt: now,
        attemptCount: next.attempts + 1,
        lockedUntil: new Date(now.getTime() + LEASE_MS),
      })
      .where(and(eq(aiRunTable.id, next.id), eq(aiRunTable.status, "queued")))
      .returning();
    return claimed ?? null;
  });
}

async function extendLease(row: AiRunRow) {
  await db
    .update(aiRunTable)
    .set({ lockedUntil: new Date(Date.now() + LEASE_MS) })
    .where(ownedBy(row));
}

/** Executes a claimed run under a heartbeat. */
export async function processRun(row: AiRunRow): Promise<void> {
  await publishRunUpdated({
    workspaceId: row.workspaceId,
    runId: row.id,
    principalUserId: row.principalUserId,
    taskId: row.taskId,
    status: "running",
  });
  const heartbeat = setInterval(() => {
    extendLease(row).catch((error) => {
      console.error(`agents: lease renewal failed for ${row.id}`, error);
    });
  }, HEARTBEAT_MS);
  heartbeat.unref();
  try {
    await executeRun(row);
  } catch (error) {
    // The id only: prompts and workspace data never reach the logs.
    console.error(`agents: run ${row.id} failed`, {
      error: error instanceof Error ? error.name : "unknown",
    });
    Sentry.captureException(error, {
      tags: { area: "ai-agent", runId: row.id },
    });
    await finishRun(row, { status: "failed", error: "INTERNAL" });
  } finally {
    clearInterval(heartbeat);
  }
}

/** Claims and runs one queued run; returns its id, or null when idle. */
export async function runNextAgentRun(): Promise<string | null> {
  const row = await claimNextRun();
  if (!row) return null;
  await processRun(row);
  return row.id;
}

// --- The in-process workers ---

let enabled = false;
let workers = 0;
let pending: Promise<void> | null = null;
let resolvePending: (() => void) | null = null;

/** Lets enqueue start work (the scheduler calls it; tests drain by hand). */
export function enableAgentRunner(value = true): void {
  enabled = value;
}

/**
 * Starts workers up to MARGAYA_AI_AGENT_CONCURRENCY (default 2). Resolves
 * when this instance's workers are idle.
 */
export function kickAgentRunner(): Promise<void> {
  if (!enabled) return Promise.resolve();
  const limit = envInt("MARGAYA_AI_AGENT_CONCURRENCY", 2);
  if (!pending) {
    pending = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
  }
  const done = pending;
  while (workers < limit) {
    workers += 1;
    // Workers run outside the request that queued the run: its audit store,
    // event initiator and per-request memos must not leak into the run.
    void auditContext.exit(() =>
      eventContext.exit(async () => {
        try {
          while (enabled && (await runNextAgentRun()) !== null) {
            // Keep draining.
          }
        } catch (error) {
          console.error("agents: a worker stopped", {
            error: error instanceof Error ? error.name : "unknown",
          });
        } finally {
          workers -= 1;
          if (workers === 0) {
            resolvePending?.();
            pending = null;
            resolvePending = null;
          }
        }
      }),
    );
  }
  return done;
}

/** Runs queued work until the queue is empty (tests, one process). */
export async function drainAgentRuns(): Promise<number> {
  let count = 0;
  while ((await runNextAgentRun()) !== null) count += 1;
  return count;
}

/**
 * Requeues runs whose lease ran out, unless a write was already applied
 * (replaying would repeat it): those fail as interrupted. Expires approvals
 * older than 24 hours. Then nudges the workers.
 */
export async function maintainAgentRuns(now: Date = new Date()) {
  const expired = await db
    .select({ id: aiRunTable.id, attempts: aiRunTable.attemptCount })
    .from(aiRunTable)
    .where(
      and(eq(aiRunTable.status, "running"), lt(aiRunTable.lockedUntil, now)),
    );
  let requeued = 0;
  let failed = 0;
  for (const run of expired) {
    const [wrote] = await db
      .select({ id: aiRunStepTable.id })
      .from(aiRunStepTable)
      .where(
        and(
          eq(aiRunStepTable.runId, run.id),
          inArray(aiRunStepTable.resultStatus, ["applied", "pending"]),
        ),
      )
      .limit(1);
    const retry = !wrote && run.attempts < MAX_RUN_ATTEMPTS;
    const [waiting] = await db
      .select({ id: aiApprovalTable.id })
      .from(aiApprovalTable)
      .where(
        and(
          eq(aiApprovalTable.runId, run.id),
          eq(aiApprovalTable.status, "pending"),
        ),
      )
      .limit(1);
    const [row] = await db
      .update(aiRunTable)
      .set(
        retry
          ? { status: "queued", lockedUntil: null }
          : {
              // Applied changes stay reviewable and undoable.
              status: waiting ? "awaiting_approval" : "failed",
              error: "INTERRUPTED",
              lockedUntil: null,
              finishedAt: now,
            },
      )
      .where(
        and(
          eq(aiRunTable.id, run.id),
          eq(aiRunTable.status, "running"),
          eq(aiRunTable.attemptCount, run.attempts),
        ),
      )
      .returning();
    if (!row) continue;
    if (retry) requeued += 1;
    else failed += 1;
    await publishRunUpdated({
      workspaceId: row.workspaceId,
      runId: row.id,
      principalUserId: row.principalUserId,
      taskId: row.taskId,
      status: row.status,
    });
  }

  const stale = await db
    .update(aiApprovalTable)
    .set({ status: "expired", decidedAt: now })
    .where(
      and(
        eq(aiApprovalTable.status, "pending"),
        lt(aiApprovalTable.expiresAt, now),
      ),
    )
    .returning({
      runId: aiApprovalTable.runId,
      stepId: aiApprovalTable.stepId,
    });
  if (stale.length > 0) {
    await db
      .update(aiRunStepTable)
      .set({ resultStatus: "expired" })
      .where(
        and(
          inArray(
            aiRunStepTable.id,
            stale.map((row) => row.stepId),
          ),
          eq(aiRunStepTable.resultStatus, "pending"),
        ),
      );
    for (const runId of new Set(stale.map((row) => row.runId))) {
      await settleRun(runId);
    }
  }

  // Questions nobody answered within a day: the run fails, and its
  // question (and any answers) are dropped with its input.
  const unanswered = await db
    .update(aiRunTable)
    .set({
      status: "failed",
      error: "NEEDS_INPUT_EXPIRED",
      input: null,
      finishedAt: now,
    })
    .where(
      and(
        eq(aiRunTable.status, "needs_input"),
        sql`(${aiRunTable.input}->>'askedAt')::timestamptz < ${new Date(now.getTime() - NEEDS_INPUT_TTL_MS).toISOString()}::timestamptz`,
      ),
    )
    .returning();
  for (const row of unanswered) {
    await publishRunUpdated({
      workspaceId: row.workspaceId,
      runId: row.id,
      principalUserId: row.principalUserId,
      taskId: row.taskId,
      status: row.status,
    });
  }

  void kickAgentRunner();
  return {
    requeued,
    failed,
    expiredApprovals: stale.length,
    expiredQuestions: unanswered.length,
  };
}
