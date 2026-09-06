import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  type CycleChange,
  publishCycleChanges,
} from "../cycle/controllers/membership";
import db from "../database";
import { columnTable, cycleTable, labelTable } from "../database/schema";
import { assertTaskEstimatePoint } from "../estimate/assert-task-estimate";
import { publishEvent } from "../events";
import {
  type ModuleActivity,
  publishModuleTasksChanged,
} from "../module/controllers/membership";
import {
  joinCycle,
  joinModules,
} from "../task-draft/controllers/publish-draft";
import { isLabelColor } from "../task-draft/schema";
import type { Transaction } from "./assignee-writes";

// B13 §3.8: the optional extras of an imported task. Every problem is soft:
// the value is dropped with a warning and the task is still created.

export const MAX_IMPORT_TASKS = 5000;
export const MAX_IMPORT_LABELS = 20;
export const MAX_IMPORT_MODULES = 20;
const MAX_LABEL_NAME = 50;
// The create-label dialog's default color.
const DEFAULT_LABEL_COLOR = "gray";

export type ImportLabelInput = string | { name: string; color?: string };

export type ImportExtrasInput = {
  labels?: ImportLabelInput[];
  cycleId?: string;
  moduleIds?: string[];
  estimatePointId?: string;
};

type ImportProject = {
  id: string;
  workspaceId: string;
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
  estimatesEnabled: boolean;
};

/** What every task of one import shares, loaded once. */
export type ImportFacts = {
  project: ImportProject;
  /** Lower-cased column name → slug, for board columns (not triage). */
  columnSlugByName: Map<string, string>;
  /** Lower-cased label name → color of a same-named workspace label. */
  labelColorByName: Map<string, string>;
  /** Ids of this project's cycles. */
  projectCycleIds: Set<string>;
};

export async function loadImportFacts(
  project: ImportProject,
  tasks: readonly ImportExtrasInput[],
): Promise<ImportFacts> {
  const columns = await db
    .select({ slug: columnTable.slug, name: columnTable.name })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, project.id),
        ne(columnTable.group, "triage"),
      ),
    )
    .orderBy(asc(columnTable.position));
  const columnSlugByName = new Map<string, string>();
  for (const column of columns) {
    const key = column.name.trim().toLowerCase();
    if (!columnSlugByName.has(key)) columnSlugByName.set(key, column.slug);
  }

  const labelColorByName = new Map<string, string>();
  if (tasks.some((task) => task.labels?.length)) {
    const labels = await db
      .select({ name: labelTable.name, color: labelTable.color })
      .from(labelTable)
      .where(eq(labelTable.workspaceId, project.workspaceId));
    for (const label of labels) {
      const key = label.name.trim().toLowerCase();
      if (!labelColorByName.has(key)) labelColorByName.set(key, label.color);
    }
  }

  const cycleIds = [
    ...new Set(tasks.map((task) => task.cycleId).filter(Boolean)),
  ] as string[];
  const projectCycleIds = new Set<string>();
  if (cycleIds.length > 0) {
    const cycles = await db
      .select({ id: cycleTable.id })
      .from(cycleTable)
      .where(
        and(
          inArray(cycleTable.id, cycleIds),
          eq(cycleTable.projectId, project.id),
        ),
      );
    for (const cycle of cycles) projectCycleIds.add(cycle.id);
  }

  return { project, columnSlugByName, labelColorByName, projectCycleIds };
}

/** The status to import: a slug as sent, else a column matched by name. */
export function resolveImportStatus(
  status: string,
  validStatuses: readonly string[],
  facts: ImportFacts,
): string {
  if (validStatuses.includes(status)) return status;
  return facts.columnSlugByName.get(status.trim().toLowerCase()) ?? status;
}

type PlannedLabel = { name: string; color: string };

/** The validated extras of one task, and the warnings for what was dropped. */
export type ImportExtrasPlan = {
  labels: PlannedLabel[];
  cycleId: string | null;
  moduleIds: string[];
  estimatePointId: string | null;
  warnings: string[];
};

function planLabels(
  input: readonly ImportLabelInput[],
  facts: ImportFacts,
  warnings: string[],
): PlannedLabel[] {
  const planned: PlannedLabel[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    const rawName = typeof entry === "string" ? entry : entry.name;
    const name = (rawName ?? "").trim();
    if (name.length === 0 || name.length > MAX_LABEL_NAME) {
      warnings.push(
        `Label ${name || "(empty)"} skipped: names are 1-${MAX_LABEL_NAME} characters`,
      );
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (planned.length >= MAX_IMPORT_LABELS) {
      warnings.push(
        `Label ${name} skipped: at most ${MAX_IMPORT_LABELS} labels per task`,
      );
      continue;
    }
    seen.add(key);
    const given = typeof entry === "string" ? undefined : entry.color?.trim();
    const color =
      facts.labelColorByName.get(key) ??
      (given && isLabelColor(given) ? given : DEFAULT_LABEL_COLOR);
    planned.push({ name, color });
  }
  return planned;
}

/** Checks what can be checked before the insert; the rest happens in it. */
export function planImportExtras(
  task: ImportExtrasInput,
  facts: ImportFacts,
): ImportExtrasPlan {
  const warnings: string[] = [];
  const { project } = facts;

  const labels = planLabels(task.labels ?? [], facts, warnings);

  let cycleId: string | null = null;
  if (task.cycleId) {
    if (!project.cyclesEnabled) {
      warnings.push("Cycle skipped: cycles are turned off for this project");
    } else if (!facts.projectCycleIds.has(task.cycleId)) {
      warnings.push("Cycle skipped: not a cycle of this project");
    } else {
      cycleId = task.cycleId;
    }
  }

  const moduleIds: string[] = [];
  for (const moduleId of new Set(task.moduleIds ?? [])) {
    if (!project.modulesEnabled) {
      warnings.push(
        `Module ${moduleId} skipped: modules are turned off for this project`,
      );
    } else if (moduleIds.length >= MAX_IMPORT_MODULES) {
      warnings.push(
        `Module ${moduleId} skipped: at most ${MAX_IMPORT_MODULES} modules per task`,
      );
    } else {
      moduleIds.push(moduleId);
    }
  }

  let estimatePointId: string | null = null;
  if (task.estimatePointId) {
    if (project.estimatesEnabled) estimatePointId = task.estimatePointId;
    else {
      warnings.push(
        "Estimate skipped: estimates are turned off for this project",
      );
    }
  }

  return { labels, cycleId, moduleIds, estimatePointId, warnings };
}

/**
 * The estimate to store, checked inside the insert's transaction. A point
 * outside the active system is dropped with a warning (no SQL error, so the
 * transaction stays usable).
 */
export async function checkImportEstimate(
  tx: Transaction,
  plan: ImportExtrasPlan,
  projectId: string,
): Promise<string | null> {
  if (!plan.estimatePointId) return null;
  try {
    await assertTaskEstimatePoint(projectId, plan.estimatePointId, tx);
    return plan.estimatePointId;
  } catch (error) {
    if (!(error instanceof HTTPException)) throw error;
    plan.warnings.push(`Estimate skipped: ${error.message}`);
    return null;
  }
}

export type AppliedExtras = {
  labels: PlannedLabel[];
  cycleChange: CycleChange | null;
  moduleEntries: ModuleActivity[];
};

/** Labels, cycle and modules for the new task, in its transaction. */
export async function applyImportExtras(
  tx: Transaction,
  plan: ImportExtrasPlan,
  task: { id: string; projectId: string },
  workspaceId: string,
  userId: string,
): Promise<AppliedExtras> {
  const labels =
    plan.labels.length > 0
      ? await tx
          .insert(labelTable)
          .values(
            plan.labels.map((label) => ({
              ...label,
              taskId: task.id,
              workspaceId,
            })),
          )
          .onConflictDoNothing({ target: [labelTable.taskId, labelTable.name] })
          .returning({ name: labelTable.name, color: labelTable.color })
      : [];

  let cycleChange: CycleChange | null = null;
  if (plan.cycleId) {
    cycleChange = await joinCycle(tx, plan.cycleId, task.id, userId);
    if (!cycleChange) {
      plan.warnings.push(
        "Cycle skipped: the cycle is completed or archived and takes no tasks",
      );
    }
  }

  const moduleEntries = await joinModules(
    tx,
    plan.moduleIds,
    task.projectId,
    task.id,
    userId,
  );
  const joined = new Set(moduleEntries.map((entry) => entry.moduleId));
  for (const moduleId of plan.moduleIds) {
    if (!joined.has(moduleId)) {
      plan.warnings.push(
        `Module ${moduleId} skipped: not an active module of this project`,
      );
    }
  }

  return { labels, cycleChange, moduleEntries };
}

/** The membership and label events, after the task's commit. */
export async function publishImportExtras(
  applied: AppliedExtras,
  task: { id: string; projectId: string },
  userId: string,
) {
  for (const label of applied.labels) {
    await publishEvent("task.label_created", {
      projectId: task.projectId,
      taskId: task.id,
      userId,
      label,
      type: "label_created",
    });
  }
  if (applied.cycleChange) {
    await publishCycleChanges({
      projectId: task.projectId,
      userId,
      changes: [applied.cycleChange],
    });
  }
  for (const entry of applied.moduleEntries) {
    await publishModuleTasksChanged({
      projectId: task.projectId,
      userId,
      moduleId: entry.moduleId,
      moduleName: entry.moduleName,
      added: [task.id],
      removed: [],
    });
  }
}
