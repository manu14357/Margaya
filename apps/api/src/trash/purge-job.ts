import { and, asc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import db from "../database";
import {
  pageTable,
  projectTable,
  taskTable,
  whiteboardTable,
} from "../database/schema";
import { HOURLY_JOB_HOLD_MS, withJobLease } from "../scheduler/leader-lock";
import { hardDeleteTasks } from "./hard-delete";
import { hardDeletePage } from "./page-trash";
import { hardDeleteProject } from "./project-trash";
import { purgeCutoff, trashRetentionDays } from "./settings";
import { hardDeleteWhiteboard } from "./whiteboard-trash";

// Hourly, on one instance at a time (C7): trash older than
// TRASH_RETENTION_DAYS is deleted permanently through the same code as a
// manual "Delete permanently". Projects go first, so their tasks, pages and
// whiteboards leave with them; then trashed tasks, pages and whiteboards of
// live projects. 0 days turns it off.

export const TRASH_PURGE_LEASE = "trash-purge";
const LEASE_MS = 10 * 60 * 1000;

export type TrashPurgeLimits = { batch: number; budgetMs: number };

export const DEFAULT_TRASH_PURGE_LIMITS: TrashPurgeLimits = {
  batch: 200,
  budgetMs: 2 * 60 * 1000,
};

export type TrashPurgeOutcome = {
  degraded: boolean;
  projects: number;
  tasks: number;
  pages: number;
  whiteboards: number;
};

const NOTHING: TrashPurgeOutcome = {
  degraded: false,
  projects: 0,
  tasks: 0,
  pages: 0,
  whiteboards: 0,
};

async function purgeOnce(
  cutoff: Date,
  limits: TrashPurgeLimits,
): Promise<TrashPurgeOutcome> {
  const startedAt = Date.now();
  const outcome = { ...NOTHING };
  const failedProjects = new Set<string>();

  while (Date.now() - startedAt < limits.budgetMs) {
    const projects = await db
      .select()
      .from(projectTable)
      .where(
        and(
          isNotNull(projectTable.deletedAt),
          lt(projectTable.deletedAt, cutoff),
        ),
      )
      .orderBy(asc(projectTable.deletedAt))
      .limit(limits.batch + failedProjects.size);
    const due = projects.filter((project) => !failedProjects.has(project.id));
    for (const project of due) {
      try {
        if (await hardDeleteProject(project, null)) outcome.projects += 1;
      } catch (error) {
        failedProjects.add(project.id);
        outcome.degraded = true;
        console.error(`trash: failed to purge project ${project.id}`, error);
      }
    }
    if (due.length < limits.batch) break;
  }

  while (Date.now() - startedAt < limits.budgetMs) {
    const tasks = await db
      .select({ id: taskTable.id })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        and(
          isNotNull(taskTable.deletedAt),
          lt(taskTable.deletedAt, cutoff),
          // Tasks of a trashed project leave with the project.
          isNull(projectTable.deletedAt),
        ),
      )
      .orderBy(asc(taskTable.deletedAt))
      .limit(limits.batch);
    if (tasks.length === 0) break;
    try {
      const deleted = await hardDeleteTasks(
        tasks.map((task) => task.id),
        null,
      );
      outcome.tasks += deleted.length;
    } catch (error) {
      outcome.degraded = true;
      console.error("trash: failed to purge tasks", error);
      break;
    }
    if (tasks.length < limits.batch) break;
  }

  const failedPages = new Set<string>();
  while (Date.now() - startedAt < limits.budgetMs) {
    const rows = await db
      .select({ page: pageTable })
      .from(pageTable)
      .innerJoin(projectTable, eq(projectTable.id, pageTable.projectId))
      .where(
        and(
          isNotNull(pageTable.deletedAt),
          lt(pageTable.deletedAt, cutoff),
          // Pages of a trashed project leave with the project.
          isNull(projectTable.deletedAt),
        ),
      )
      .orderBy(asc(pageTable.deletedAt))
      .limit(limits.batch + failedPages.size);
    const due = rows.filter(({ page }) => !failedPages.has(page.id));
    for (const { page } of due) {
      try {
        if (await hardDeletePage(page, null)) outcome.pages += 1;
      } catch (error) {
        failedPages.add(page.id);
        outcome.degraded = true;
        console.error(`trash: failed to purge page ${page.id}`, error);
      }
    }
    if (due.length < limits.batch) break;
  }

  const failedBoards = new Set<string>();
  while (Date.now() - startedAt < limits.budgetMs) {
    const rows = await db
      .select({ board: whiteboardTable })
      .from(whiteboardTable)
      .innerJoin(projectTable, eq(projectTable.id, whiteboardTable.projectId))
      .where(
        and(
          isNotNull(whiteboardTable.deletedAt),
          lt(whiteboardTable.deletedAt, cutoff),
          // Boards of a trashed project leave with the project.
          isNull(projectTable.deletedAt),
        ),
      )
      .orderBy(asc(whiteboardTable.deletedAt))
      .limit(limits.batch + failedBoards.size);
    const due = rows.filter(({ board }) => !failedBoards.has(board.id));
    for (const { board } of due) {
      try {
        if (await hardDeleteWhiteboard(board, null)) outcome.whiteboards += 1;
      } catch (error) {
        failedBoards.add(board.id);
        outcome.degraded = true;
        console.error(`trash: failed to purge whiteboard ${board.id}`, error);
      }
    }
    if (due.length < limits.batch) break;
  }

  if (
    outcome.projects > 0 ||
    outcome.tasks > 0 ||
    outcome.pages > 0 ||
    outcome.whiteboards > 0
  ) {
    console.log(
      `trash: purged ${outcome.projects} projects, ${outcome.tasks} tasks, ${outcome.pages} pages and ${outcome.whiteboards} whiteboards`,
    );
  }
  return outcome;
}

/** The scheduler entry: one bounded pass on one instance at a time. */
export async function runTrashPurge(
  now: Date = new Date(),
  limits: TrashPurgeLimits = DEFAULT_TRASH_PURGE_LIMITS,
  days: number = trashRetentionDays(),
): Promise<TrashPurgeOutcome> {
  const cutoff = purgeCutoff(now, days);
  if (!cutoff) return { ...NOTHING };
  return withJobLease(
    TRASH_PURGE_LEASE,
    () => purgeOnce(cutoff, limits),
    () => ({ ...NOTHING }),
    { leaseMs: LEASE_MS, holdMs: HOURLY_JOB_HOLD_MS },
  );
}
