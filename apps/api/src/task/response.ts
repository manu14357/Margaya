import { columnGroupSchema } from "../column/response";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

const priorityDescription = "One of: no-priority, low, medium, high, urgent.";

const estimatePointIdSchema = z.string().nullable().openapi({
  description:
    "Point of the project's active estimate system, or null. Resolve its value with GET /estimate/{projectId}. Set it with PUT /task/estimate/{id}.",
});

const archivedAtSchema = nullableResponseTimestamp.optional().openapi({
  description:
    "When the task was archived; null while it is not. An archived task keeps its column (status).",
});

const createdBySchema = z.string().nullable().optional().openapi({
  description:
    "The user who created the task; null for tasks made by integrations or whose creator was deleted.",
});

export const assigneeIdsSchema = z.array(z.string()).openapi({
  description: "Every assignee's user id, first assignee first.",
});

export const taskAssigneeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    image: z.string().nullable(),
  })
  .openapi("TaskAssignee", {
    description: "A task assignee: the user id, display name and avatar URL.",
  });

const assigneesSchema = z.array(taskAssigneeSchema).openapi({
  description: "Every assignee, first assignee first.",
});

export const taskSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    position: z.number().nullable().openapi({
      description: "Order within its column, ascending.",
    }),
    number: z.number().nullable().openapi({
      description: "Per-project counter shown as {projectSlug}-{number}.",
    }),
    userId: z.string().nullable().openapi({
      description: "The first assignee, or null. Mirrors `assigneeIds[0]`.",
    }),
    assigneeIds: assigneeIdsSchema,
    title: z.string(),
    description: z.string().nullable(),
    descriptionDeferred: z.boolean().optional().openapi({
      description:
        "True when the list omits a large description; load the task detail or description pages to read it. Do not replace stored text with this null summary.",
    }),
    status: z.string().openapi({
      description:
        "The slug of the column the task sits in, or planned. Archived tasks keep theirs; see archivedAt.",
    }),
    priority: z.string().openapi({ description: priorityDescription }),
    startDate: nullableResponseTimestamp,
    dueDate: nullableResponseTimestamp,
    completedAt: nullableResponseTimestamp.optional().openapi({
      description:
        "When the task entered a completed-group column; null while it is not completed. Archiving never changes it.",
    }),
    estimatePointId: estimatePointIdSchema,
    archivedAt: archivedAtSchema,
    createdBy: createdBySchema,
    createdAt: responseTimestamp,
    customFields: z
      .array(z.object({ fieldId: z.string(), value: z.string() }))
      .optional(),
  })
  .openapi("Task");

const taskCycleIdSchema = z.string().nullable().openapi({
  description:
    "The cycle the task is planned in, or null. Always null while the project's cycles feature is off.",
});

export const taskWithAssigneeSchema = taskSchema
  .extend({
    assigneeName: z
      .string()
      .nullable()
      .openapi({ description: "The first assignee's name." }),
    assigneeId: z
      .string()
      .nullable()
      .openapi({ description: "The first assignee's id." }),
    assignees: assigneesSchema,
    cycleId: taskCycleIdSchema,
  })
  .openapi("TaskWithAssignee");

const taskLabelSchema = z
  .object({ id: z.string(), name: z.string(), color: z.string() })
  .openapi("TaskLabel");

export const taskExternalLinkSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    integrationId: z.string(),
    resourceType: z.string(),
    externalId: z.string(),
    url: z.string(),
    title: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable().openapi({
      description:
        "Provider-specific payload, already parsed from the stored JSON string.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("TaskExternalLink");

export const boardTaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    number: z.number().nullable(),
    description: z.string().nullable(),
    descriptionDeferred: z.boolean().optional().openapi({
      description:
        "True when the list omits a large description; load the task detail or description pages to read it. Do not replace stored text with this null summary.",
    }),
    status: z.string(),
    priority: z.string().openapi({ description: priorityDescription }),
    startDate: nullableResponseTimestamp,
    dueDate: nullableResponseTimestamp,
    position: z.number().nullable(),
    createdAt: responseTimestamp,
    archivedAt: archivedAtSchema,
    createdBy: createdBySchema,
    userId: z
      .string()
      .nullable()
      .openapi({ description: "The first assignee, or null." }),
    assigneeName: z
      .string()
      .nullable()
      .openapi({ description: "The first assignee's name." }),
    assigneeId: z
      .string()
      .nullable()
      .openapi({ description: "The first assignee's id." }),
    assigneeImage: z
      .string()
      .nullable()
      .openapi({ description: "The first assignee's avatar URL." }),
    assigneeIds: assigneeIdsSchema,
    assignees: z.array(taskAssigneeSchema).openapi({
      description:
        "Every assignee, first assignee first. Always complete on every page and related page.",
    }),
    projectId: z.string(),
    cycleId: taskCycleIdSchema,
    estimatePointId: estimatePointIdSchema,
    labels: z.array(taskLabelSchema),
    externalLinks: z.array(taskExternalLinkSchema),
    isRecurring: z.boolean().optional().openapi({
      description:
        "True while the task repeats (it holds the series' repeat rule).",
    }),
  })
  .openapi("BoardTask");

export const boardColumnSchema = z
  .object({
    id: z.string().openapi({ description: "The column slug, same as `slug`." }),
    slug: z.string(),
    name: z.string(),
    icon: z.string().nullable(),
    group: columnGroupSchema,
    isFinal: z.boolean().openapi({
      description: "True exactly when the group is completed or cancelled.",
    }),
    position: z.number().optional(),
    tasks: z.array(boardTaskSchema),
  })
  .openapi("BoardColumn");

export const boardSchema = z
  .object({
    data: z
      .object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        icon: z.string().nullable(),
        description: z.string().nullable(),
        descriptionDeferred: z.boolean().optional().openapi({
          description:
            "True when a project description above 64 KiB is omitted; use project detail or public project description pages for full text.",
        }),
        isPublic: z.boolean().nullable(),
        workspaceId: z.string(),
        columns: z.array(boardColumnSchema),
        archivedTasks: z.array(boardTaskSchema).openapi({
          description:
            "Archived tasks of any column, planned included; they appear nowhere else.",
        }),
        plannedTasks: z.array(boardTaskSchema).openapi({
          description: "Planned tasks that are not archived.",
        }),
      })
      .openapi("Board"),
    pagination: z
      .object({
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        totalPages: z.number(),
        relatedPage: z.number(),
        relatedPageSize: z.number(),
        relatedTotalPages: z.number(),
      })
      .openapi({
        description:
          "Always paginated: 50 tasks by default, at most 100 per page. Continue through totalPages to retrieve all tasks. For each task page, follow relatedPage through relatedTotalPages to retrieve all labels, external links and columns (100 related rows per kind per request, plus up to 100 columns needed to represent the tasks).",
      })
      .openapi("BoardPagination"),
  })
  .openapi("BoardResponse");

export const bulkResultSchema = z
  .object({ success: z.boolean(), updatedCount: z.number() })
  .openapi("BulkTaskResult");

export const moveTaskResultSchema = z
  .object({
    task: taskSchema,
    sourceProjectId: z.string(),
    destinationProjectId: z.string(),
  })
  .openapi("MoveTaskResult");

export const taskExportSchema = z
  .object({
    project: z
      .object({
        name: z.string(),
        slug: z.string(),
        description: z.string().nullable(),
        exportedAt: z.string().openapi({ format: "date-time" }),
      })
      .openapi("TaskExportProject"),
    tasks: z.array(
      z
        .object({
          title: z.string(),
          description: z.string(),
          status: z.string(),
          priority: z.string(),
          dueDate: z.string().nullable().openapi({ format: "date-time" }),
          startDate: z.string().nullable().openapi({ format: "date-time" }),
          archivedAt: z.string().nullable().optional().openapi({
            format: "date-time",
            description:
              "Set when the task is archived; its status is its column.",
          }),
          userId: z
            .string()
            .nullable()
            .openapi({ description: "The first assignee, or null." }),
          assigneeIds: assigneeIdsSchema,
          labels: z
            .array(
              z
                .object({ name: z.string(), color: z.string() })
                .openapi("ExportedTaskLabel"),
            )
            .openapi({
              description: "Label names and colors, without their ids.",
            }),
        })
        .openapi("ExportedTask"),
    ),
  })
  .openapi("TaskExport");

export const taskImportResultSchema = z
  .object({
    results: z
      .object({
        total: z.number(),
        successful: z.number(),
        failed: z.number(),
        tasks: z.array(z.unknown()).openapi({
          description: "Per-task outcome, each carrying a success flag.",
        }),
      })
      .openapi("TaskImportSummary"),
  })
  .openapi("TaskImportResult");

export const imageUploadSchema = z
  .object({
    key: z.string().openapi({
      description: "Object key to send back to the finalize route.",
    }),
    uploadUrl: z.string().openapi({
      description: "Presigned URL to PUT the image bytes to.",
    }),
    headers: z.record(z.string(), z.string()).openapi({
      description:
        "Headers that must accompany the upload request, including Content-Type.",
    }),
  })
  .openapi("TaskImageUpload");

export const finalizedAssetSchema = z
  .object({
    id: z.string(),
    url: z.string().openapi({
      description: "Where the stored image can be read back from.",
    }),
  })
  .openapi("TaskImageAsset");

export const descriptionPageSchema = z
  .object({
    content: z.string(),
    version: z.string(),
    nextOffset: z.number().nullable(),
  })
  .openapi("TaskDescriptionPage");
export const descriptionMatchesSchema = z
  .object({ ids: z.array(z.string()), nextCursor: z.string().nullable() })
  .openapi("TaskDescriptionMatches");

export const taskKeyLookupSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    number: z.number(),
    key: z.string().openapi({
      description: "The canonical key, in upper case (WEB-12).",
    }),
  })
  .openapi("TaskKeyLookup");

export const similarTasksSchema = z
  .object({
    tasks: z.array(
      z.object({
        id: z.string(),
        number: z.number().nullable(),
        key: z.string().openapi({ description: "The task key (WEB-12)." }),
        title: z.string(),
        status: z.string(),
      }),
    ),
  })
  .openapi("SimilarTasks", {
    description:
      "Up to five open tasks of the project like the typed title (full-text ranked), best match first.",
  });
