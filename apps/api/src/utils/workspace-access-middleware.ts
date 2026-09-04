import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { validateWorkspaceAccess } from "./validate-workspace-access";

type WorkspaceIdSource =
  | { type: "query"; key: string }
  | { type: "body"; key: string }
  | { type: "param"; key: string }
  | {
      type: "lookup";
      resource:
        | "project"
        | "task"
        | "label"
        | "timeEntry"
        | "activity"
        | "comment"
        | "column"
        | "workflowRule"
        | "customField"
        | "trashedTask"
        | "trashedProject";
      idKey: string;
    }
  | {
      type: "lookupMany";
      resource: "task";
      idKey: string;
    };

type WorkspaceAccessMiddlewareConfig = {
  sources: WorkspaceIdSource[];
  // When set, a looked-up id that matches no resource answers 404 with this
  // message instead of the generic 400. Opt-in because many routes document
  // the 400.
  notFoundMessage?: string;
};

async function readJsonObjectBody(
  c: Context,
): Promise<Record<string, unknown>> {
  const raw = (await c.req.json().catch(() => ({}))) || {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

export function workspaceAccessMiddleware(
  config: WorkspaceAccessMiddlewareConfig,
) {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");

    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    let workspaceId: string | null = null;
    let unknownLookup = false;

    for (const source of config.sources) {
      if (source.type === "query") {
        workspaceId = c.req.query(source.key) || null;
      } else if (source.type === "body") {
        const body = await readJsonObjectBody(c);
        const bodyValue = body[source.key];
        workspaceId = typeof bodyValue === "string" ? bodyValue : null;
      } else if (source.type === "param") {
        workspaceId = c.req.param(source.key) || null;
      } else if (source.type === "lookup") {
        const body = await readJsonObjectBody(c);
        const bodyId = body[source.idKey];
        const idFromBody = typeof bodyId === "string" ? bodyId : null;
        // Only accept the id from the same place the handler will read it
        // (path param or JSON body). Accepting it from the query string let a
        // caller authorize against one resource (`?taskId=<mine>`) while the
        // handler acted on another (`{"taskId": "<someone else's>"}`).
        const id = c.req.param(source.idKey) || idFromBody;
        if (id) {
          const found = await lookupWorkspaceId(source.resource, id);
          // A trashed task or project (C7) reads as gone, and must not fall
          // through to a later source such as `?workspaceId=`.
          if (found === TRASHED) {
            throw new HTTPException(404, {
              message: TRASHED_MESSAGE[source.resource],
            });
          }
          workspaceId = found;
          unknownLookup = !workspaceId;
        }
      } else if (source.type === "lookupMany") {
        const body = await readJsonObjectBody(c);
        const ids = body[source.idKey];
        if (Array.isArray(ids)) {
          const taskIds = ids.filter(
            (id): id is string => typeof id === "string",
          );
          if (taskIds.length > 0) {
            const tasks = await db
              .select({ workspaceId: schema.projectTable.workspaceId })
              .from(schema.taskTable)
              .innerJoin(
                schema.projectTable,
                eq(schema.taskTable.projectId, schema.projectTable.id),
              )
              .where(
                and(
                  inArray(schema.taskTable.id, taskIds),
                  // Trashed tasks (C7) read as gone.
                  isNull(schema.taskTable.deletedAt),
                ),
              );
            const workspaceIds = [
              ...new Set(tasks.map((task) => task.workspaceId)),
            ];
            if (workspaceIds.length === 0) {
              throw new HTTPException(404, { message: "No tasks found" });
            }
            if (workspaceIds.length > 1) {
              throw new HTTPException(400, {
                message: "All tasks must belong to the same workspace",
              });
            }
            workspaceId = workspaceIds[0] ?? null;
          }
        }
      }

      if (workspaceId) {
        break;
      }
    }

    if (!workspaceId && unknownLookup && config.notFoundMessage) {
      throw new HTTPException(404, { message: config.notFoundMessage });
    }

    if (!workspaceId) {
      throw new HTTPException(400, {
        message: "Workspace ID could not be determined",
      });
    }

    const apiKey = c.get("apiKey");
    const apiKeyId = apiKey?.id;

    await validateWorkspaceAccess(userId, workspaceId, apiKeyId);

    c.set("workspaceId", workspaceId);

    return next();
  };
}

// Lookup result for a resource that exists but is in the trash, or whose
// task or project is (C7).
const TRASHED = Symbol("trashed");

type LookupResource =
  | "project"
  | "task"
  | "label"
  | "timeEntry"
  | "activity"
  | "comment"
  | "column"
  | "workflowRule"
  | "customField"
  | "trashedTask"
  | "trashedProject";

const TRASHED_MESSAGE: Record<LookupResource, string> = {
  project: "Project not found",
  task: "Task not found",
  label: "Label not found",
  timeEntry: "Time entry not found",
  activity: "Activity not found",
  comment: "Comment not found",
  column: "Column not found",
  workflowRule: "Workflow rule not found",
  customField: "Custom field not found",
  trashedTask: "Task not found in the trash",
  trashedProject: "Project not found in the trash",
};

/** The workspace, or TRASHED when any of the given trash stamps is set. */
function liveWorkspace(
  row:
    | {
        workspaceId: string | null;
        taskDeletedAt?: Date | null;
        projectDeletedAt?: Date | null;
      }
    | undefined,
): string | null | typeof TRASHED {
  if (!row?.workspaceId) return null;
  if (row.taskDeletedAt || row.projectDeletedAt) return TRASHED;
  return row.workspaceId;
}

async function lookupWorkspaceId(
  resource: LookupResource,
  id: string,
): Promise<string | null | typeof TRASHED> {
  try {
    switch (resource) {
      case "project": {
        const [project] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectDeletedAt: schema.projectTable.deletedAt,
          })
          .from(schema.projectTable)
          .where(eq(schema.projectTable.id, id))
          .limit(1);
        return liveWorkspace(project);
      }

      case "task": {
        const [task] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            taskDeletedAt: schema.taskTable.deletedAt,
            projectDeletedAt: schema.projectTable.deletedAt,
          })
          .from(schema.taskTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.taskTable.id, id))
          .limit(1);
        return liveWorkspace(task);
      }

      case "label": {
        const [label] = await db
          .select({
            workspaceId: schema.labelTable.workspaceId,
            taskId: schema.labelTable.taskId,
            taskWorkspaceId: schema.projectTable.workspaceId,
            taskDeletedAt: schema.taskTable.deletedAt,
            projectDeletedAt: schema.projectTable.deletedAt,
          })
          .from(schema.labelTable)
          .leftJoin(
            schema.taskTable,
            eq(schema.labelTable.taskId, schema.taskTable.id),
          )
          .leftJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.labelTable.id, id))
          .limit(1);
        // Older releases allowed inconsistent label/task references. Never use
        // such a row to authorize reads, mutations or external provider sync.
        if (label?.taskId && label.taskWorkspaceId !== label.workspaceId) {
          return null;
        }
        // A label on a trashed task reads as gone (C7). Workspace labels have
        // no task, so the stamps stay null.
        return liveWorkspace(label);
      }

      case "timeEntry": {
        const [timeEntry] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            taskDeletedAt: schema.taskTable.deletedAt,
            projectDeletedAt: schema.projectTable.deletedAt,
          })
          .from(schema.timeEntryTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.timeEntryTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.timeEntryTable.id, id))
          .limit(1);
        return liveWorkspace(timeEntry);
      }

      case "activity": {
        const [activity] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            taskDeletedAt: schema.taskTable.deletedAt,
            projectDeletedAt: schema.projectTable.deletedAt,
          })
          .from(schema.activityTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.activityTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.activityTable.id, id))
          .limit(1);
        return liveWorkspace(activity);
      }

      case "comment": {
        const [comment] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            taskDeletedAt: schema.taskTable.deletedAt,
            projectDeletedAt: schema.projectTable.deletedAt,
          })
          .from(schema.activityTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.activityTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(
            and(
              eq(schema.activityTable.id, id),
              eq(schema.activityTable.type, "comment"),
            ),
          )
          .limit(1);
        return liveWorkspace(comment);
      }

      case "column": {
        const [column] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectDeletedAt: schema.projectTable.deletedAt,
          })
          .from(schema.columnTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.columnTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.columnTable.id, id))
          .limit(1);
        return liveWorkspace(column);
      }

      case "workflowRule": {
        const [workflowRule] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectDeletedAt: schema.projectTable.deletedAt,
          })
          .from(schema.workflowRuleTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.workflowRuleTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.workflowRuleTable.id, id))
          .limit(1);
        return liveWorkspace(workflowRule);
      }

      case "customField": {
        const [field] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectDeletedAt: schema.projectTable.deletedAt,
          })
          .from(schema.customFieldDefinitionTable)
          .innerJoin(
            schema.projectTable,
            eq(
              schema.customFieldDefinitionTable.projectId,
              schema.projectTable.id,
            ),
          )
          .where(eq(schema.customFieldDefinitionTable.id, id))
          .limit(1);
        return liveWorkspace(field);
      }

      // Trash routes (C7): only a trashed task, or a trashed project, counts.
      case "trashedTask": {
        const [task] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            taskDeletedAt: schema.taskTable.deletedAt,
          })
          .from(schema.taskTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.taskTable.id, id))
          .limit(1);
        return task?.taskDeletedAt ? task.workspaceId : null;
      }

      case "trashedProject": {
        const [project] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectDeletedAt: schema.projectTable.deletedAt,
          })
          .from(schema.projectTable)
          .where(eq(schema.projectTable.id, id))
          .limit(1);
        return project?.projectDeletedAt ? project.workspaceId : null;
      }

      default:
        return null;
    }
  } catch (error) {
    console.error(`Error looking up workspaceId for ${resource}:`, error);
    return null;
  }
}

export const workspaceAccess = {
  fromQuery: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "query", key }] }),

  fromBody: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "body", key }] }),

  fromParam: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "param", key }] }),

  fromProject: (idKey = "id", options: { notFoundMessage?: string } = {}) =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "project", idKey }],
      ...options,
    }),

  fromTask: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "task", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromTaskId: (idKey = "taskId") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "task", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromTasks: (idKey = "taskIds") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookupMany", resource: "task", idKey }],
    }),

  fromLabel: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "label", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromTimeEntry: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "timeEntry", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromActivity: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "activity", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromComment: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "comment", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromColumn: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "column", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromWorkflowRule: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "workflowRule", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromCustomField: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "customField", idKey }],
    }),

  /** A task in the trash (C7); live or unknown tasks answer 404. */
  fromTrashedTask: (idKey = "taskId") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "trashedTask", idKey }],
      notFoundMessage: "Task not found in the trash",
    }),

  /** A project in the trash (C7); live or unknown projects answer 404. */
  fromTrashedProject: (idKey = "projectId") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "trashedProject", idKey }],
      notFoundMessage: "Project not found in the trash",
    }),

  fromProjectId: (idKey = "projectId") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "project", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),
};
