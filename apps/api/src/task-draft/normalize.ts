import { normalizeAssigneeIds } from "../task/assignee-rules";
import { validateAndParseDate } from "../utils/validate-dates";
import type { TaskDraftPatch } from "./schema";

// Pure draft rules: normalizing input, the project-change rule and the
// response blanking. No database access; validate.ts checks references.

export type DraftLabel = { name: string; color: string };
export type DraftCustomFieldValue = { fieldId: string; value: string };

/** A draft's stored values. */
export type DraftValues = {
  projectId: string | null;
  title: string;
  description: string;
  status: string | null;
  priority: string;
  assigneeIds: string[];
  labels: DraftLabel[];
  startDate: Date | null;
  dueDate: Date | null;
  customFieldValues: DraftCustomFieldValue[];
  cycleId: string | null;
  moduleIds: string[];
  estimatePointId: string | null;
  parentTaskId: string | null;
};

export type DraftKey = keyof DraftValues;
export type DraftChanges = Partial<DraftValues>;

export const EMPTY_DRAFT: DraftValues = {
  projectId: null,
  title: "",
  description: "",
  status: null,
  priority: "no-priority",
  assigneeIds: [],
  labels: [],
  startDate: null,
  dueDate: null,
  customFieldValues: [],
  cycleId: null,
  moduleIds: [],
  estimatePointId: null,
  parentTaskId: null,
};

function emptyValue(key: DraftKey): unknown {
  const value = EMPTY_DRAFT[key];
  return Array.isArray(value) ? [] : value;
}

/** Values that only mean something inside the draft's project. */
export const PROJECT_BOUND_KEYS = [
  "status",
  "customFieldValues",
  "cycleId",
  "moduleIds",
  "estimatePointId",
  "parentTaskId",
] as const satisfies readonly DraftKey[];

/** Trims names; a later label with the same name (any case) replaces it. */
export function normalizeLabels(labels: readonly DraftLabel[]): DraftLabel[] {
  const byName = new Map<string, DraftLabel>();
  for (const label of labels) {
    const name = label.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    byName.delete(key);
    byName.set(key, { name, color: label.color });
  }
  return [...byName.values()];
}

/** One value per field; a later duplicate replaces the earlier value. */
export function normalizeCustomFieldValues(
  values: readonly DraftCustomFieldValue[],
): DraftCustomFieldValue[] {
  const byField = new Map<string, DraftCustomFieldValue>();
  for (const { fieldId, value } of values) {
    byField.set(fieldId, { fieldId, value });
  }
  return [...byField.values()];
}

/** Trimmed, blank-free ids, each once, in first-seen order. */
export function normalizeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

function parseDate(value: string | null, field: string): Date | null {
  return value === null ? null : validateAndParseDate(value, field);
}

/**
 * The stored-value changes a request asks for: only the keys it sent,
 * normalized. Invalid dates and too many assignees are 400s.
 */
export function parseDraftPatch(patch: TaskDraftPatch): DraftChanges {
  const changes: DraftChanges = {};
  if (patch.projectId !== undefined) changes.projectId = patch.projectId;
  if (patch.title !== undefined) changes.title = patch.title.trim();
  if (patch.description !== undefined) changes.description = patch.description;
  if (patch.status !== undefined) changes.status = patch.status;
  if (patch.priority !== undefined) changes.priority = patch.priority;
  if (patch.assigneeIds !== undefined)
    changes.assigneeIds = normalizeAssigneeIds(patch.assigneeIds);
  if (patch.labels !== undefined)
    changes.labels = normalizeLabels(patch.labels);
  if (patch.startDate !== undefined)
    changes.startDate = parseDate(patch.startDate, "startDate");
  if (patch.dueDate !== undefined)
    changes.dueDate = parseDate(patch.dueDate, "dueDate");
  if (patch.customFieldValues !== undefined)
    changes.customFieldValues = normalizeCustomFieldValues(
      patch.customFieldValues,
    );
  if (patch.cycleId !== undefined) changes.cycleId = patch.cycleId;
  if (patch.moduleIds !== undefined)
    changes.moduleIds = normalizeIds(patch.moduleIds);
  if (patch.estimatePointId !== undefined)
    changes.estimatePointId = patch.estimatePointId;
  if (patch.parentTaskId !== undefined)
    changes.parentTaskId = patch.parentTaskId;
  return changes;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

/**
 * Applies changes to the stored values. A new project (null included)
 * clears the project-bound values the request did not send; assignees and
 * labels are workspace-level and stay. Returns the keys whose value moved.
 */
export function applyDraftChanges(
  current: DraftValues,
  changes: DraftChanges,
): { next: DraftValues; changed: DraftKey[]; projectChanged: boolean } {
  const next: DraftValues = { ...current };
  const projectChanged =
    changes.projectId !== undefined && changes.projectId !== current.projectId;

  if (projectChanged) {
    for (const key of PROJECT_BOUND_KEYS) {
      if (changes[key] === undefined) {
        (next as Record<DraftKey, unknown>)[key] = emptyValue(key);
      }
    }
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }

  const changed = (Object.keys(next) as DraftKey[]).filter(
    (key) => !sameValue(next[key], current[key]),
  );
  return { next, changed, projectChanged };
}

/**
 * What a response shows: without a project, the project-bound values are
 * empty even when stale ones remain in the row (the project was deleted).
 */
export function visibleDraftValues(values: DraftValues): DraftValues {
  if (values.projectId !== null) return values;
  const blanked: DraftValues = { ...values };
  for (const key of PROJECT_BOUND_KEYS) {
    (blanked as Record<DraftKey, unknown>)[key] = emptyValue(key);
  }
  return blanked;
}
