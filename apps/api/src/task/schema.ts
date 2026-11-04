import { z } from "../openapi";
import { MAX_TASK_ASSIGNEES, TOO_MANY_ASSIGNEES } from "./assignee-rules";
import { MAX_TASK_POSITION } from "./controllers/next-task-position";
import { VALID_PRIORITIES } from "./validate-task-fields";

// A coarse guard; the exact limit is checked after trimming and
// de-duplicating (assignee-rules.ts).
const assigneeIdList = z
  .array(z.string())
  .max(MAX_TASK_ASSIGNEES, TOO_MANY_ASSIGNEES);

const pagingNumber = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, "Expected a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

export const taskParam = z.object({ id: z.string() });

export const taskKeyParam = z.object({
  workspaceId: z.string(),
  key: z.string().max(200).openapi({
    description:
      "The readable task key: the project key, a hyphen and the task number (WEB-12). Case-insensitive.",
    example: "WEB-12",
  }),
});

export const projectIdParam = z.object({ projectId: z.string() });

const priority = z.enum(VALID_PRIORITIES);

// Required object of optional filters: a RouteParameter cannot itself be optional.
export const listTasksQuery = z.object({
  status: z.string().optional().openapi({
    description:
      "A column slug or planned (tasks there that are not archived), or archived (archived tasks of any column).",
  }),
  priority: z.string().optional(),
  assigneeId: z.string().optional().openapi({
    description: "Only tasks where this user is one of the assignees.",
  }),
  // Number("abc") is NaN, which used to reach the limit/offset clause unchecked.
  page: pagingNumber(1, 1_000_000).optional(),
  relatedPage: pagingNumber(1, 1_000_000).optional(),
  limit: pagingNumber(1, 100).optional(),
  sortBy: z
    .enum([
      "createdAt",
      "priority",
      "dueDate",
      "position",
      "title",
      "number",
      "estimate",
    ])
    .optional()
    .openapi({
      description:
        "estimate orders by the estimate value's position in its system; tasks without an estimate come last in both directions.",
    }),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  dueBefore: z.string().optional(),
  dueAfter: z.string().optional(),
  estimatePointId: z.string().max(2000).optional().openapi({
    description:
      "Comma-separated estimate point ids; include `none` for tasks without an estimate.",
  }),
});

export const bulkUpdateBody = z.object({
  taskIds: z.array(z.string()).min(1),
  operation: z
    .enum([
      "updateStatus",
      "updatePriority",
      "updateAssignee",
      "addAssignee",
      "removeAssignee",
      "delete",
      "addLabel",
      "removeLabel",
      "updateDueDate",
      "updateStartDate",
      "updateEstimate",
      "archive",
      "unarchive",
      "move",
    ])
    .openapi({
      description:
        "updateAssignee replaces every task's assignees with one user (null clears them); addAssignee and removeAssignee add or remove one user and keep the others. archive and unarchive archive or restore the tasks in their columns; updateStatus with the value archived is an alias of archive, and updateStatus with a column restores archived tasks. move sends the tasks to another project of the workspace, all or none: they get new task keys, keep their status when the destination has it and otherwise take its first column, and leave their cycle, modules and estimate. Labels and assignees stay. A custom field value follows to a destination field of the same name and type, and is removed when there is none. Tasks already in the destination are skipped.",
    }),
  value: z.string().nullable().optional().openapi({
    description:
      "The new value for the chosen operation. Unused by `delete`, `archive` and `unarchive`; null clears the assignees (updateAssignee), a due or start date, or an estimate; updateStartDate is refused when the date falls after a selected task's due date; a user id for addAssignee and removeAssignee. updateEstimate takes a point of the project's active estimate system and needs every task in one project. move takes the destination project's id.",
  }),
});

export const createTaskBody = z.object({
  title: z.string(),
  description: z.string(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  priority,
  status: z.string().openapi({ description: "The target column's slug." }),
  assigneeIds: assigneeIdList.optional().openapi({
    description:
      "Workspace members to assign, in order; the first becomes `userId`. Takes precedence over `userId`. Omit both this and `userId` to get the project's default assignee; send an empty list for no assignee.",
  }),
  userId: z.string().optional().openapi({
    description: "Deprecated single assignee; use `assigneeIds`.",
  }),
  customFields: z
    .array(z.object({ fieldId: z.string(), value: z.string() }))
    .optional(),
  estimatePointId: z.string().nullable().optional().openapi({
    description:
      "A point of the project's active estimate system. Needs the project's estimates feature on; null or omitted means no estimate.",
  }),
  parentId: z.string().min(1).optional().openapi({
    description:
      "Creates the task as a subtask of this task, in the same transaction. The parent must be a live task of the same project that is not waiting in intake, and the caller also needs task:update.",
  }),
  isMilestone: z.boolean().optional().openapi({
    description:
      "Creates the task as a milestone, which the timeline draws on its due date.",
  }),
});

export const updateTaskBody = z.object({
  title: z.string(),
  description: z.string().optional().openapi({
    description:
      "Omit to preserve the existing description when updating a list summary.",
  }),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  priority,
  status: z.string(),
  projectId: z.string(),
  position: z.number().int().min(0).max(MAX_TASK_POSITION),
  assigneeIds: assigneeIdList.optional().openapi({
    description:
      "Replaces the assignees. Omit it to keep them when `userId` equals the current first assignee.",
  }),
  userId: z.string().optional().openapi({
    description:
      "Deprecated. Echoing the current first assignee keeps every assignee; another id replaces them all; omitting it or sending an empty string clears them.",
  }),
});

export const moveTaskBody = z.object({
  destinationProjectId: z.string(),
  destinationStatus: z.string().optional().openapi({
    description: "Defaults to the destination project's first column.",
  }),
});

export const importTasksBody = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string().optional(),
      status: z.string(),
      priority: z.string().optional(),
      startDate: z.string().nullable().optional(),
      dueDate: z.string().nullable().optional(),
      assigneeIds: assigneeIdList.nullable().optional().openapi({
        description:
          "Workspace members to assign, in order; the first becomes `userId`. Takes precedence over `userId`.",
      }),
      userId: z.string().nullable().optional().openapi({
        description: "Deprecated single assignee; use `assigneeIds`.",
      }),
      archivedAt: z.string().nullable().optional().openapi({
        description:
          "An ISO date-time: the task is imported archived at that time, in its column. The legacy status `archived` imports it archived in the first completed column.",
      }),
      labels: z
        .array(
          z.union([
            z.string(),
            z.object({ name: z.string(), color: z.string().optional() }),
          ]),
        )
        .max(200)
        .optional()
        .openapi({
          description:
            "Up to 20 label names (1-50 characters), or { name, color }. A same-named workspace label's color wins, then the given color, then gray. Extra or invalid labels are skipped with a warning.",
        }),
      cycleId: z.string().optional().openapi({
        description:
          "A cycle of this project that still takes tasks (cycles on). Otherwise skipped with a warning.",
      }),
      moduleIds: z.array(z.string()).max(200).optional().openapi({
        description:
          "Up to 20 active modules of this project (modules on). Others are skipped with a warning.",
      }),
      estimatePointId: z.string().optional().openapi({
        description:
          "A value of the project's active estimate system (estimates on). Otherwise skipped with a warning.",
      }),
    }),
  ),
});

export const updateStatusBody = z.object({ status: z.string() });
export const updatePositionBody = z.object({
  position: z.number().int().min(0).max(MAX_TASK_POSITION),
  status: z.string().optional().openapi({
    description:
      "The column to move the task to. Omit it to keep the column, which is all a reorder needs.",
  }),
});
export const updatePriorityBody = z.object({ priority });
export const updateMilestoneBody = z.object({ isMilestone: z.boolean() });
export const updateAssigneeBody = z.object({
  userId: z.string().nullable().openapi({
    description:
      "The one assignee that replaces all others; null (or blank) unassigns everyone.",
  }),
});
export const setAssigneesBody = z.object({
  assigneeIds: assigneeIdList.openapi({
    description: "The complete list; empty unassigns everyone.",
  }),
});
export const patchAssigneesBody = z.object({
  add: assigneeIdList
    .optional()
    .openapi({ description: "Users to add, appended in this order." }),
  remove: assigneeIdList
    .optional()
    .openapi({ description: "Users to remove." }),
});
export const updateDueDateBody = z.object({ dueDate: z.string().optional() });
const scheduleDate = (name: string) =>
  z
    .string()
    .nullable()
    .optional()
    .openapi({
      description: `The new ${name}, as an ISO date or instant. null clears it; leave it out to keep the current one.`,
      example: "2026-11-09T00:00:00.000Z",
    });
export const updateDatesBody = z
  .object({
    startDate: scheduleDate("start date"),
    dueDate: scheduleDate("due date"),
  })
  .refine(
    (body) => body.startDate !== undefined || body.dueDate !== undefined,
    { message: "Send startDate, dueDate or both" },
  );
export const updateTitleBody = z.object({ title: z.string() });
export const updateDescriptionBody = z.object({ description: z.string() });

const surface = z.enum(["description", "comment"]).openapi({
  description: "Where the image is used, which decides how it is scoped.",
});

export const imageUploadBody = z.object({
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  surface,
});

export const finalizeImageUploadBody = z.object({
  key: z
    .string()
    .openapi({ description: "The key returned when the URL was issued." }),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  surface,
});

export const descriptionPageQuery = z.object({
  offset: pagingNumber(0, 2_000_000_000).default(0),
  version: z
    .string()
    .regex(/^[0-9]{1,10}$/)
    .optional(),
});
export const descriptionMatchesQuery = z.object({
  query: z.string().trim().min(1).max(256),
  after: z.string().min(1).max(128).optional(),
});

export const similarTasksQuery = z.object({
  q: z.string().trim().min(1).max(256).openapi({
    description:
      "The title being typed. Words of three or more letters are searched in open tasks' titles and descriptions.",
  }),
});
