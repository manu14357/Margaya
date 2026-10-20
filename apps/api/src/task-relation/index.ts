import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import db from "../database";
import { projectTable, taskRelationTable, taskTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createTaskRelation from "./controllers/create-task-relation";
import deleteTaskRelation from "./controllers/delete-task-relation";
import getProjectDependencies from "./controllers/get-project-dependencies";
import getTaskRelations from "./controllers/get-task-relations";
import setTaskParent from "./controllers/set-task-parent";
import {
  projectDependenciesSchema,
  taskParentResultSchema,
  taskRelationSchema,
  taskRelationWithTasksListSchema,
} from "./response";
import {
  createTaskRelationBody,
  projectIdParam,
  setTaskParentBody,
  taskIdParam,
  taskRelationParam,
} from "./schema";

async function workspaceIdOfTask(taskId: string) {
  const [task] = await db
    .select({
      workspaceId: projectTable.workspaceId,
      projectId: projectTable.id,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);
  return task ?? null;
}

function requireUserId(c: Context) {
  const userId = c.get("userId");
  if (!userId) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return userId as string;
}

// Route middleware runs before the request validators, so these read the raw
// request rather than c.req.valid(), which is not populated yet.
async function scopeToSourceTask(c: Context, next: Next) {
  const userId = requireUserId(c);

  const body = (await c.req.json().catch(() => ({}))) as {
    sourceTaskId?: unknown;
  };
  const sourceTaskId =
    typeof body?.sourceTaskId === "string" ? body.sourceTaskId : null;
  if (!sourceTaskId) {
    throw new HTTPException(400, { message: "sourceTaskId is required" });
  }

  const source = await workspaceIdOfTask(sourceTaskId);
  if (!source) {
    throw new HTTPException(404, { message: "Source task not found" });
  }
  const { workspaceId, projectId } = source;

  await validateWorkspaceAccess(
    userId,
    workspaceId,
    c.get("apiKey")?.id,
    projectId,
  );
  c.set("workspaceId", workspaceId);
  c.set("projectId", projectId);
  return next();
}

async function scopeToRelation(c: Context, next: Next) {
  const userId = requireUserId(c);

  const id = c.req.param("id");
  const [rel] = await db
    .select({ sourceTaskId: taskRelationTable.sourceTaskId })
    .from(taskRelationTable)
    .where(eq(taskRelationTable.id, id ?? ""))
    .limit(1);
  if (!rel) {
    throw new HTTPException(404, { message: "Task relation not found" });
  }

  const source = await workspaceIdOfTask(rel.sourceTaskId);
  if (!source) {
    throw new HTTPException(404, { message: "Task not found" });
  }
  const { workspaceId, projectId } = source;

  await validateWorkspaceAccess(
    userId,
    workspaceId,
    c.get("apiKey")?.id,
    projectId,
  );
  c.set("workspaceId", workspaceId);
  c.set("projectId", projectId);
  return next();
}

const getTaskRelationsRoute = createRoute({
  method: "get",
  operationId: "getTaskRelations",
  path: "/{taskId}",
  tags: ["Task Relations"],
  summary: "Get task relations",
  description:
    "Get every relation where the task is the source or the target, oldest first, each with a summary of both linked tasks (including their project key, project name and status group). Linked tasks may be in other projects of the workspace. Relations pointing outside the caller's workspace are omitted.",
  middleware: [workspaceAccess.fromTaskId("taskId")] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse(
      "Task relations with the linked task summaries",
      taskRelationWithTasksListSchema,
    ),
    400: errorResponse(
      "Unknown task, or its workspace could not be determined",
    ),
    403: errorResponse("No access to the task's workspace"),
  },
});

const getProjectDependenciesRoute = createRoute({
  method: "get",
  operationId: "getProjectDependencies",
  path: "/project/{projectId}",
  tags: ["Task Relations"],
  summary: "List project dependencies",
  description:
    "List the relations that order tasks in time (blocks, start_before and finish_before) between two non-archived tasks of the project, oldest first, as ids only. Used to draw dependency lines on the timeline. At most 5000 are returned; truncated says whether more exist.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse(
      "The project's dependency relations",
      projectDependenciesSchema,
    ),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("No access to the project's workspace"),
  },
});

const createTaskRelationRoute = createRoute({
  method: "post",
  operationId: "createTaskRelation",
  path: "/",
  tags: ["Task Relations"],
  summary: "Create task relation",
  description:
    "Link two tasks of the workspace, possibly in different projects (a subtask's parent must be in its own project). Authorization is scoped to the source task's workspace. Two tasks share at most one non-subtask relation, in either direction; a task has at most 200 of them and at most one parent. blocks, start_before and finish_before relations may not form a loop of the same type. Tasks waiting in intake can't be linked. Returns the stored row, whose ids are swapped for the inverse names.",
  middleware: [
    scopeToSourceTask,
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTaskRelationBody } },
    },
  },
  responses: {
    200: jsonResponse("The created relation", taskRelationSchema),
    400: errorResponse(
      "Invalid body, a task related to itself, a task waiting in intake, a circular dependency, a parent in another project or among the task's own subtasks, or more than 200 relations",
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Source or target task not found"),
    409: errorResponse(
      "The relation already exists, the tasks are already related by another type, or the child already has a parent",
    ),
  },
});

const setTaskParentRoute = createRoute({
  method: "put",
  operationId: "setTaskParent",
  path: "/parent/{taskId}",
  tags: ["Task Relations"],
  summary: "Set task parent",
  description:
    "Set, change or clear a task's parent in one step: every current parent row is replaced (legacy data can hold several). The parent must be a task of the same project that is not one of the task's own subtasks, and neither task may be waiting in intake. Sending the current parent (or null without one) changes nothing.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: setTaskParentBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The task's parent after the change",
      taskParentResultSchema,
    ),
    400: errorResponse(
      "Invalid body, unknown task, the task itself, a parent in another project or among the task's subtasks, or a task waiting in intake",
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Parent task not found"),
  },
});

const deleteTaskRelationRoute = createRoute({
  method: "delete",
  operationId: "deleteTaskRelation",
  path: "/{id}",
  tags: ["Task Relations"],
  summary: "Delete task relation",
  description: "Remove a link between two tasks. Returns the deleted relation.",
  middleware: [
    scopeToRelation,
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: taskRelationParam },
  responses: {
    200: jsonResponse("The deleted relation", taskRelationSchema),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Task relation not found, or its source task is gone"),
  },
});

const taskRelation = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getTaskRelationsRoute, async (c) =>
    c.json(
      await getTaskRelations(c.req.valid("param").taskId, c.get("workspaceId")),
      200,
    ),
  )
  .openapi(getProjectDependenciesRoute, async (c) =>
    c.json(await getProjectDependencies(c.req.valid("param").projectId), 200),
  )
  .openapi(createTaskRelationRoute, async (c) => {
    const { sourceTaskId, targetTaskId, relationType } = c.req.valid("json");
    return c.json(
      await createTaskRelation({
        sourceTaskId,
        targetTaskId,
        relationType,
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
      }),
      200,
    );
  })
  .openapi(setTaskParentRoute, async (c) =>
    c.json(
      await setTaskParent({
        taskId: c.req.valid("param").taskId,
        parentTaskId: c.req.valid("json").parentTaskId,
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
      }),
      200,
    ),
  )
  .openapi(deleteTaskRelationRoute, async (c) =>
    c.json(
      await deleteTaskRelation(
        c.req.valid("param").id,
        c.get("userId"),
        c.get("workspaceId"),
      ),
      200,
    ),
  );

export default taskRelation;
