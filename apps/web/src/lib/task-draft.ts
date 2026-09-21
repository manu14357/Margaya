// Pure helpers between the create-task dialog's form and a task draft
// (B11 §4.5): form values to draft fields and back, the create-modal slot
// mapping, "has content", the shallow diff of Save draft, and the label of
// properties a publish could not keep.

import type {
  DroppedDraftField,
  TaskDraft,
  TaskDraftPatch,
} from "@/types/task-draft";

/** Create-modal slot ids (registered by B2, B3 and B6) and draft fields. */
export const DRAFT_SLOT_IDS = {
  cycle: "cycle",
  modules: "module",
  estimate: "estimate",
} as const;

export type DraftFormValues = {
  projectId: string;
  title: string;
  description: string;
  /** A column slug or planned; null is "the entry column at publish". */
  status: string | null;
  priority: string;
  assigneeIds: readonly string[];
  labels: ReadonlyArray<{ name: string; color: string }>;
  startDate?: Date;
  dueDate?: Date;
  /** Field id to value; blank values are not stored. */
  customFieldValues: Readonly<Record<string, string>>;
  /** One value per create-modal slot. */
  slotValues: Readonly<Record<string, unknown>>;
};

/** Every field a draft stores, in the request's shape. */
export type DraftFields = Required<
  Pick<
    TaskDraftPatch,
    | "projectId"
    | "title"
    | "description"
    | "status"
    | "priority"
    | "assigneeIds"
    | "labels"
    | "startDate"
    | "dueDate"
    | "customFieldValues"
    | "cycleId"
    | "moduleIds"
    | "estimatePointId"
  >
>;

const PROJECT_BOUND_FIELDS = [
  "status",
  "customFieldValues",
  "cycleId",
  "moduleIds",
  "estimatePointId",
] as const satisfies ReadonlyArray<keyof DraftFields>;

type Priority = NonNullable<TaskDraftPatch["priority"]>;

const PRIORITIES: readonly Priority[] = [
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
];

function asPriority(value: string): Priority {
  return (PRIORITIES as readonly string[]).includes(value)
    ? (value as Priority)
    : "no-priority";
}

function slotId(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function slotIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (entry): entry is string => typeof entry === "string" && !!entry,
          ),
        ),
      ]
    : [];
}

/** Labels unique by name, ignoring case; the last duplicate wins. */
function uniqueLabels(
  labels: DraftFormValues["labels"],
): DraftFields["labels"] {
  const byName = new Map<string, { name: string; color: string }>();
  for (const label of labels) {
    const name = label.name.trim();
    if (!name) continue;
    byName.delete(name.toLowerCase());
    byName.set(name.toLowerCase(), { name, color: label.color });
  }
  return [...byName.values()];
}

/** The draft fields of the dialog's current values. */
export function formToDraftFields(values: DraftFormValues): DraftFields {
  const projectId = values.projectId || null;
  const bound = Boolean(projectId);
  return {
    projectId,
    title: values.title.trim(),
    description: values.description.trim(),
    status: bound ? values.status : null,
    priority: asPriority(values.priority),
    assigneeIds: [...new Set(values.assigneeIds)],
    labels: uniqueLabels(values.labels),
    startDate: values.startDate ? values.startDate.toISOString() : null,
    dueDate: values.dueDate ? values.dueDate.toISOString() : null,
    customFieldValues: bound
      ? Object.entries(values.customFieldValues)
          .filter(([, value]) => value.trim() !== "")
          .map(([fieldId, value]) => ({ fieldId, value }))
      : [],
    cycleId: bound ? slotId(values.slotValues[DRAFT_SLOT_IDS.cycle]) : null,
    moduleIds: bound ? slotIds(values.slotValues[DRAFT_SLOT_IDS.modules]) : [],
    estimatePointId: bound
      ? slotId(values.slotValues[DRAFT_SLOT_IDS.estimate])
      : null,
  };
}

/** The dialog's starting values for a stored draft. */
export function draftToFormValues(draft: TaskDraft): DraftFormValues {
  const slotValues: Record<string, unknown> = {};
  if (draft.cycleId) slotValues[DRAFT_SLOT_IDS.cycle] = draft.cycleId;
  if (draft.moduleIds.length) {
    slotValues[DRAFT_SLOT_IDS.modules] = [...draft.moduleIds];
  }
  if (draft.estimatePointId) {
    slotValues[DRAFT_SLOT_IDS.estimate] = draft.estimatePointId;
  }
  return {
    projectId: draft.projectId ?? "",
    title: draft.title,
    description: draft.description,
    status: draft.status,
    priority: draft.priority,
    assigneeIds: [...draft.assigneeIds],
    labels: draft.labels.map((label) => ({ ...label })),
    startDate: draft.startDate ? new Date(draft.startDate) : undefined,
    dueDate: draft.dueDate ? new Date(draft.dueDate) : undefined,
    customFieldValues: Object.fromEntries(
      draft.customFieldValues.map(({ fieldId, value }) => [fieldId, value]),
    ),
    slotValues,
  };
}

/** True when the dialog holds anything worth saving as a draft. */
export function hasDraftContent(values: DraftFormValues): boolean {
  const fields = formToDraftFields(values);
  return Boolean(
    fields.title ||
      fields.description ||
      fields.projectId ||
      fields.priority !== "no-priority" ||
      fields.assigneeIds.length ||
      fields.labels.length ||
      fields.startDate ||
      fields.dueDate ||
      fields.customFieldValues.length ||
      fields.cycleId ||
      fields.moduleIds.length ||
      fields.estimatePointId,
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The fields that changed, for Save draft. A new project clears the
 * project-bound fields on the server unless they are sent, so all of them
 * travel with a project change.
 */
export function diffDraftFields(
  base: DraftFields,
  next: DraftFields,
): TaskDraftPatch {
  const patch: Record<string, unknown> = {};
  const projectChanged = base.projectId !== next.projectId;
  for (const key of Object.keys(next) as (keyof DraftFields)[]) {
    const bound = (PROJECT_BOUND_FIELDS as readonly string[]).includes(key);
    if ((bound && projectChanged) || !sameValue(base[key], next[key])) {
      patch[key] = next[key];
    }
  }
  return patch as TaskDraftPatch;
}

export function isEmptyPatch(patch: TaskDraftPatch): boolean {
  return Object.keys(patch).length === 0;
}

/** A draft can be published with a project and a title. */
export function canPublishDraft(fields: {
  projectId: string | null | undefined;
  title: string;
}): boolean {
  return Boolean(fields.projectId) && fields.title.trim().length > 0;
}

/** "status, cycle": the properties a publish could not keep. */
export function droppedListLabel(
  dropped: readonly DroppedDraftField[],
  t: (key: string) => string,
): string {
  return dropped.map((field) => t(`tasks:drafts.dropped.${field}`)).join(", ");
}

/** The task key as shown: the API returns the slug as stored. */
export function displayTaskKey(key: string): string {
  return key.toUpperCase();
}
