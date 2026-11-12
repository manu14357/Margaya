import { and, asc, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import db from "../database";
import {
  activityTable,
  columnTable,
  projectAutomationTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { HOURLY_JOB_HOLD_MS, withJobLease } from "../scheduler/leader-lock";
import type { Transaction } from "../task/assignee-writes";
import {
  MAX_TASK_POSITION,
  nextTaskPosition,
} from "../task/controllers/next-task-position";
import { taskColumnJoin } from "../task/scope";
import { resolveTimezone } from "../utils/zoned-date";
import {
  archiveEligibility,
  closeEligibility,
  type EligibilityInput,
} from "./eligibility";

// Scheduled automations (§3.4): hourly, under a job lease, bounded per tick.
// Each batch is one transaction that also writes the history rows; one
// task.automation_applied per project and rule follows the commit. No
// per-task events, notifications or integrations (K12).

export const PROJECT_AUTOMATIONS_LEASE = "project-automations";
const LEASE_MS = 15 * 60 * 1000;

export type AutomationJobLimits = {
  /** Projects visited per tick, least recently checked first. */
  projects: number;
  /** Tasks per project and rule per tick. */
  batch: number;
  /** Tasks per tick, all projects together. */
  overall: number;
  /** No new batch starts after this many milliseconds. */
  budgetMs: number;
};

export const DEFAULT_AUTOMATION_JOB_LIMITS: AutomationJobLimits = {
  projects: 200,
  batch: 500,
  overall: 5000,
  budgetMs: 4 * 60 * 1000,
};

export type AutomationJobOutcome = {
  degraded: boolean;
  projects: number;
  archived: number;
  closed: number;
};

type QueuedProject = {
  projectId: string;
  workspaceId: string;
  timezone: string;
  cyclesOn: boolean;
  modulesOn: boolean;
  autoArchiveEnabled: boolean;
  autoArchiveMonths: number;
  autoCloseEnabled: boolean;
  autoCloseMonths: number;
  autoCloseColumnId: string | null;
};

async function loadQueue(limit: number): Promise<QueuedProject[]> {
  return db
    .select({
      projectId: projectAutomationTable.projectId,
      workspaceId: projectTable.workspaceId,
      timezone: workspaceTable.timezone,
      cyclesOn: projectTable.cyclesEnabled,
      modulesOn: projectTable.modulesEnabled,
      autoArchiveEnabled: projectAutomationTable.autoArchiveEnabled,
      autoArchiveMonths: projectAutomationTable.autoArchiveMonths,
      autoCloseEnabled: projectAutomationTable.autoCloseEnabled,
      autoCloseMonths: projectAutomationTable.autoCloseMonths,
      autoCloseColumnId: projectAutomationTable.autoCloseColumnId,
    })
    .from(projectAutomationTable)
    .innerJoin(
      projectTable,
      eq(projectTable.id, projectAutomationTable.projectId),
    )
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(
      and(
        or(
          eq(projectAutomationTable.autoArchiveEnabled, true),
          eq(projectAutomationTable.autoCloseEnabled, true),
        ),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .orderBy(
      sql`${projectAutomationTable.lastCheckedAt} asc nulls first`,
      asc(projectAutomationTable.projectId),
    )
    .limit(limit);
}

/** Up to `limit` eligible tasks, oldest update first, skipping busy rows. */
async function pickTasks(tx: Transaction, eligible: SQL, limit: number) {
  return tx
    .select({ id: taskTable.id, status: taskTable.status })
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(eligible)
    .orderBy(asc(taskTable.updatedAt), asc(taskTable.id))
    .limit(limit)
    .for("update", { of: taskTable, skipLocked: true });
}

function eligibilityOf(project: QueuedProject, months: number, now: Date) {
  return {
    projectId: project.projectId,
    now,
    months,
    timezone: resolveTimezone(project.timezone),
    cyclesOn: project.cyclesOn,
    modulesOn: project.modulesOn,
  } satisfies EligibilityInput;
}

async function archiveBatch(
  project: QueuedProject,
  now: Date,
  limit: number,
): Promise<string[]> {
  const months = project.autoArchiveMonths;
  const taskIds = await db.transaction(async (tx) => {
    const picked = await pickTasks(
      tx,
      archiveEligibility(eligibilityOf(project, months, now)),
      limit,
    );
    if (picked.length === 0) return [];
    const ids = picked.map((task) => task.id);
    await tx
      .update(taskTable)
      .set({ archivedAt: now })
      .where(and(inArray(taskTable.id, ids), isNull(taskTable.archivedAt)));
    await tx.insert(activityTable).values(
      ids.map((taskId) => ({
        taskId,
        type: "archived",
        userId: null,
        eventData: { automation: { rule: "auto_archive", months } },
      })),
    );
    return ids;
  });

  if (taskIds.length > 0) {
    await publishEvent("task.automation_applied", {
      projectId: project.projectId,
      workspaceId: project.workspaceId,
      rule: "auto_archive",
      taskIds,
      count: taskIds.length,
      months,
    });
  }
  return taskIds;
}

async function loadCancelledColumn(project: QueuedProject) {
  if (!project.autoCloseColumnId) return null;
  const [column] = await db
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      group: columnTable.group,
    })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.id, project.autoCloseColumnId),
        eq(columnTable.projectId, project.projectId),
      ),
    )
    .limit(1);
  return column?.group === "cancelled" ? column : null;
}

async function closeBatch(
  project: QueuedProject,
  now: Date,
  limit: number,
): Promise<string[]> {
  // Missing or moved out of the cancelled group: paused until fixed.
  const column = await loadCancelledColumn(project);
  if (!column) return [];

  const months = project.autoCloseMonths;
  const taskIds = await db.transaction(async (tx) => {
    // The project first, like task creates and moves, so positions can't
    // collide and the lock order stays deadlock-free.
    await tx
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(eq(projectTable.id, project.projectId))
      .for("update");

    const base = await nextTaskPosition(
      tx,
      project.projectId,
      column.slug,
      column.id,
    );
    const room = MAX_TASK_POSITION - base + 1;
    const picked = await pickTasks(
      tx,
      closeEligibility(eligibilityOf(project, months, now)),
      Math.min(limit, room),
    );
    if (picked.length === 0) return [];

    const positions = sql.join(
      picked.map((task, index) => sql`(${task.id}, ${base + index}::integer)`),
      sql`, `,
    );
    await tx.execute(sql`
      update ${taskTable} as t
      set status = ${column.slug},
        column_id = ${column.id},
        completed_at = null,
        position = v.position,
        updated_at = ${sql.param(new Date(), taskTable.updatedAt)}
      from (values ${positions}) as v(id, position)
      where t.id = v.id and t.archived_at is null
    `);
    await tx.insert(activityTable).values(
      picked.map((task) => ({
        taskId: task.id,
        type: "status_changed",
        userId: null,
        eventData: {
          oldStatus: task.status,
          newStatus: column.slug,
          automation: { rule: "auto_close", months },
        },
      })),
    );
    return picked.map((task) => task.id);
  });

  if (taskIds.length > 0) {
    await publishEvent("task.automation_applied", {
      projectId: project.projectId,
      workspaceId: project.workspaceId,
      rule: "auto_close",
      taskIds,
      count: taskIds.length,
      months,
      columnId: column.id,
    });
  }
  return taskIds;
}

async function recordVisit(
  projectId: string,
  now: Date,
  archived: number,
  closed: number,
) {
  await db
    .update(projectAutomationTable)
    .set({
      lastCheckedAt: now,
      ...(archived > 0
        ? { lastArchivedAt: now, lastArchivedCount: archived }
        : {}),
      ...(closed > 0 ? { lastClosedAt: now, lastClosedCount: closed } : {}),
      // Settings did not change; keep their timestamp.
      updatedAt: sql`${projectAutomationTable.updatedAt}`,
    })
    .where(eq(projectAutomationTable.projectId, projectId));
}

async function runOnce(
  now: Date,
  limits: AutomationJobLimits,
): Promise<AutomationJobOutcome> {
  const startedAt = Date.now();
  const outcome: AutomationJobOutcome = {
    degraded: false,
    projects: 0,
    archived: 0,
    closed: 0,
  };
  let touched = 0;
  const tasksLeft = () => limits.overall - outcome.archived - outcome.closed;
  const outOfTime = () => Date.now() - startedAt >= limits.budgetMs;

  for (const project of await loadQueue(limits.projects)) {
    if (outOfTime() || tasksLeft() <= 0) break;
    try {
      const archived = project.autoArchiveEnabled
        ? await archiveBatch(project, now, Math.min(limits.batch, tasksLeft()))
        : [];
      outcome.archived += archived.length;

      const closed =
        project.autoCloseEnabled && tasksLeft() > 0 && !outOfTime()
          ? await closeBatch(project, now, Math.min(limits.batch, tasksLeft()))
          : [];
      outcome.closed += closed.length;

      await recordVisit(project.projectId, now, archived.length, closed.length);
      outcome.projects += 1;
      if (archived.length + closed.length > 0) touched += 1;
    } catch (error) {
      // The id only: task titles and content never reach the logs.
      console.error(`automations: project ${project.projectId} failed`, error);
      outcome.degraded = true;
    }
  }

  if (outcome.archived + outcome.closed > 0) {
    console.log(
      `automations: archived ${outcome.archived} and closed ${outcome.closed} tasks in ${touched} projects`,
    );
  }
  return outcome;
}

/** The scheduler entry: one bounded pass, on one API instance at a time. */
export async function runProjectAutomations(
  now: Date = new Date(),
  limits: AutomationJobLimits = DEFAULT_AUTOMATION_JOB_LIMITS,
): Promise<AutomationJobOutcome> {
  return withJobLease(
    PROJECT_AUTOMATIONS_LEASE,
    () => runOnce(now, limits),
    () => ({ degraded: false, projects: 0, archived: 0, closed: 0 }),
    { leaseMs: LEASE_MS, holdMs: HOURLY_JOB_HOLD_MS },
  );
}
