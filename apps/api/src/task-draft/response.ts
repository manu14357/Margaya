import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { taskSchema } from "../task/response";

const draftProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    icon: z.string().nullable(),
    archived: z.boolean(),
  })
  .openapi("TaskDraftProject");

const draftParentSchema = z
  .object({
    id: z.string(),
    key: z.string().openapi({ description: "The parent's task key." }),
    title: z.string(),
  })
  .openapi("TaskDraftParent");

const draftShape = {
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  project: draftProjectSchema.nullable(),
  title: z.string(),
  status: z.string().nullable().openapi({
    description:
      "A column slug or planned; null means the entry column at publish time. Always null without a project.",
  }),
  priority: z.string(),
  assigneeIds: z
    .array(z.string())
    .openapi({ description: "Assignees in order." }),
  labels: z.array(z.object({ name: z.string(), color: z.string() })),
  startDate: nullableResponseTimestamp,
  dueDate: nullableResponseTimestamp,
  customFieldValues: z.array(
    z.object({ fieldId: z.string(), value: z.string() }),
  ),
  cycleId: z.string().nullable(),
  moduleIds: z.array(z.string()),
  estimatePointId: z.string().nullable(),
  parentTaskId: z.string().nullable().openapi({
    description:
      "The chosen parent; null when none, or when it left the draft's project or was deleted.",
  }),
  parentTask: draftParentSchema.nullable(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
};

export const taskDraftSchema = z
  .object({ ...draftShape, description: z.string() })
  .openapi("TaskDraft", {
    description:
      "A private draft of its owner. Without a project, status, custom fields, cycle, modules and estimate are always empty.",
  });

export const taskDraftSummarySchema = z
  .object({
    ...draftShape,
    hasDescription: z.boolean(),
  })
  .openapi("TaskDraftSummary", {
    description: "A draft in lists: every TaskDraft field but the description.",
  });

export const taskDraftListSchema = z
  .object({
    drafts: z.array(taskDraftSummarySchema),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
  })
  .openapi("TaskDraftList");

export const taskDraftCountSchema = z
  .object({ count: z.number().int() })
  .openapi("TaskDraftCount");

export const taskDraftDeletedSchema = z
  .object({ id: z.string() })
  .openapi("TaskDraftDeleted");

export const DROPPED_DRAFT_FIELDS = [
  "status",
  "assignees",
  "cycle",
  "modules",
  "estimate",
  "parent",
] as const;

export type DroppedDraftField = (typeof DROPPED_DRAFT_FIELDS)[number];

export const publishedTaskDraftSchema = z
  .object({
    task: taskSchema,
    key: z.string().openapi({
      description: "The task key: the project slug, a dash and the number.",
    }),
    dropped: z.array(z.enum(DROPPED_DRAFT_FIELDS)).openapi({
      description:
        "Stored values that were no longer valid and were left out of the task.",
    }),
  })
  .openapi("PublishedTaskDraft");
