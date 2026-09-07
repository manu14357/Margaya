import { responseTimestamp, z } from "../openapi";

const activityTypeDescription =
  "One of: comment, task, create, status_changed, priority_changed, assignee_changed, unassigned, due_date_changed, title_changed, description_changed, cycle_changed, module_added, module_removed, estimate_changed, start_date_changed, label_added, label_removed, relation_added, relation_removed, parent_changed, subtask_added, subtask_removed, link_added, link_updated, link_removed, attachment_added, attachment_removed, copied_from, copied_to, archived, unarchived.Assignee rows are per person: assignee_changed carries newAssigneeId, newAssignee (name) and isSelfAssigned in eventData; unassigned carries oldAssigneeId, oldAssignee (name) and isSelfUnassigned (older unassigned rows have no eventData and mean the whole task was unassigned). cycle_changed carries oldCycleId, oldCycleName, newCycleId and newCycleName in eventData, plus reason=cycle_deleted when the old cycle was deleted. module_added and module_removed carry moduleId and moduleName, plus reason=module_deleted when the module was deleted. estimate_changed carries oldPointId, newPointId, oldValue, newValue (value text at the time, minutes for time systems) and oldType, newType (points, categories or time), plus a reason (point_deleted, system_switched, system_deleted or task_moved) when it was not a direct edit. Task-detail types keep snapshots so they stay readable after renames and deletes; a task reference is { id, key, title, projectId }: start_date_changed carries oldStartDate and newStartDate (ISO or null); label_added and label_removed carry name and color; description_changed carries nothing (saves by the same person within 10 minutes share one row); relation_added and relation_removed are written on both tasks and carry relation (the key from that task's side: blocked_by, blocking, related, duplicate, start_before, start_after, finish_before or finish_after), otherTaskId, otherTaskKey, otherTaskTitle and otherProjectId; parent_changed carries oldParent and newParent (task references or null); subtask_added and subtask_removed (on the parent) carry otherTaskId, otherTaskKey, otherTaskTitle and otherProjectId of the sub-task; link_added, link_updated and link_removed carry linkId, url, title and host (link_updated also oldUrl and oldTitle); attachment_added and attachment_removed carry attachmentId, filename, size and mimeType; copied_from (on the copy) carries sourceTaskId, sourceTaskKey, sourceTaskTitle, sourceProjectId and included (option keys); copied_to (on the source) carries copyTaskId, copyTaskKey, copyTaskTitle and copyProjectId.";

export const activitySchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    type: z.string().openapi({ description: activityTypeDescription }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    userId: z.string().nullable(),
    content: z.string().nullable(),
    eventData: z.unknown().openapi({
      description:
        "Type-specific payload, e.g. { oldStatus, newStatus } for status_changed. Null for plain comments.",
    }),
    externalUserName: z.string().nullable().openapi({
      description: "Set when the activity was imported from another tool.",
    }),
    externalUserAvatar: z.string().nullable(),
    externalSource: z.string().nullable().openapi({
      description: "The tool it was imported from, e.g. trello, jira.",
    }),
    externalUrl: z.string().nullable(),
    visibility: z.enum(["internal", "public"]).openapi({
      description:
        "Comments only: public comments also show on the project's public board. Everything else is internal.",
    }),
  })
  .openapi("Activity");

export const activityListSchema = z.array(activitySchema);

export const myActivitySchema = activitySchema
  .extend({
    task: z
      .object({
        id: z.string(),
        key: z.string().openapi({ description: "e.g. WEB-12" }),
        title: z.string(),
        projectId: z.string(),
      })
      .openapi("ActivityTaskRef"),
  })
  .openapi("MyActivity");

export const myActivityPageSchema = z
  .object({
    items: z.array(myActivitySchema),
    nextCursor: z.string().nullable().openapi({
      description: "Pass as cursor for the next page; null on the last page.",
    }),
  })
  .openapi("MyActivityPage");
