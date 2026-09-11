import { z } from "../openapi";
import { STICKY_COLORS } from "../sticky/colors";
import { MAX_TASK_ASSIGNEES } from "../task/assignee-rules";
import { VALID_PRIORITIES } from "../task/validate-task-fields";

export const TASK_DRAFTS_LIMIT = 1000;
export const TASK_DRAFT_BODY_BYTES = 1024 * 1024;
export const TASK_DRAFT_TITLE_MAX = 1000;
export const MAX_DRAFT_LABELS = 50;
export const MAX_DRAFT_CUSTOM_FIELDS = 100;
export const MAX_DRAFT_MODULES = 50;
export const DEFAULT_DRAFT_PAGE_SIZE = 50;

const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;

/** A label color key of the palette, or a hex color (synced labels). */
export function isLabelColor(value: string): boolean {
  return (
    (STICKY_COLORS as readonly string[]).includes(value) ||
    HEX_COLOR.test(value)
  );
}

export const taskDraftParam = z.object({ id: z.string() });

const draftLabel = z
  .object({
    name: z.string().trim().min(1).max(255),
    color: z.string().refine(isLabelColor, {
      message: "Use a label color key or a hex color",
    }),
  })
  .strict()
  .openapi("TaskDraftLabel", {
    description:
      "A label copied onto the task when the draft is published. Names are unique per draft, ignoring case; the last duplicate wins.",
  });

const draftCustomFieldValue = z
  .object({ fieldId: z.string().min(1), value: z.string().max(10_000) })
  .strict()
  .openapi("TaskDraftCustomFieldValue");

const nullableId = z.string().min(1).nullable().optional();

const dateInput = z.string().nullable().optional().openapi({
  description:
    'A date ("2026-05-01" or an ISO timestamp), or null to clear. The start can not be after the due date.',
});

// Shared by create, update and the publish patch. Project-bound fields need
// a project; they are cleared when the project changes, except the ones
// sent in the same request.
const draftFields = {
  projectId: nullableId.openapi({
    description:
      "A project of the draft's workspace that is not archived, or null for a workspace-level draft.",
  }),
  title: z
    .string()
    .trim()
    .max(TASK_DRAFT_TITLE_MAX)
    .optional()
    .openapi({ description: "Trimmed; may be empty until publishing." }),
  description: z.string().optional().openapi({ description: "Markdown." }),
  status: nullableId.openapi({
    description:
      "A column slug of the project (not triage) or planned. Null means the entry column at publish time. Needs a project.",
  }),
  priority: z.enum(VALID_PRIORITIES).optional(),
  assigneeIds: z.array(z.string()).max(MAX_TASK_ASSIGNEES).optional().openapi({
    description:
      "Workspace members in assignee order (duplicates keep their first place), at most 20.",
  }),
  labels: z.array(draftLabel).max(MAX_DRAFT_LABELS).optional(),
  startDate: dateInput,
  dueDate: dateInput,
  customFieldValues: z
    .array(draftCustomFieldValue)
    .max(MAX_DRAFT_CUSTOM_FIELDS)
    .optional()
    .openapi({
      description:
        "Values for fields of the project, one per field (the last duplicate wins). Needs a project.",
    }),
  cycleId: nullableId.openapi({
    description:
      "A cycle of the project that is not archived. Needs a project with cycles on.",
  }),
  moduleIds: z
    .array(z.string().min(1))
    .max(MAX_DRAFT_MODULES)
    .optional()
    .openapi({
      description:
        "Modules of the project that are not archived. Needs a project with modules on.",
    }),
  estimatePointId: nullableId.openapi({
    description:
      "A point of the project's active estimate. Needs a project with estimates on.",
  }),
};

export const createTaskDraftBody = z
  .object({ workspaceId: z.string(), ...draftFields })
  .strict()
  .openapi("CreateTaskDraftBody");

export const updateTaskDraftBody = z
  .object(draftFields)
  .strict()
  .openapi("UpdateTaskDraftBody", {
    description: "Send at least one field.",
  });

export type TaskDraftPatch = z.infer<typeof updateTaskDraftBody>;

/** Draft field keys a patch can carry. */
export const DRAFT_FIELD_KEYS = Object.keys(
  draftFields,
) as (keyof TaskDraftPatch)[];

export const listTaskDraftsQuery = z.object({
  workspaceId: z.string(),
  projectId: z.string().min(1).optional().openapi({
    description:
      "Only drafts of this project, or `none` for drafts without a project.",
  }),
  search: z.string().trim().max(100).optional().openapi({
    description: "Title contains this text, ignoring case.",
  }),
  page: z.coerce.number().int().min(1).optional().openapi({
    description: "1-based page number (default 1).",
  }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({ description: "Page size, 1-100 (default 50)." }),
});

export const countTaskDraftsQuery = z.object({ workspaceId: z.string() });
