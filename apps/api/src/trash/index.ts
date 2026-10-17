import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { projectSchema } from "../project/response";
import { requestHiddenProjectIds } from "../project/visibility";
import { taskSchema } from "../task/response";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { listProjectTrash, listWorkspaceTrash, liveProjectOf } from "./lists";
import { purgeTrashedProject, restoreTrashedProject } from "./project-trash";
import {
  emptyTrashResultSchema,
  trashedProjectListSchema,
  trashedTaskListSchema,
} from "./response";
import {
  listProjectTrashQuery,
  listTrashQuery,
  trashedTaskParam,
  trashProjectParam,
} from "./schema";
import {
  emptyProjectTrash,
  purgeTrashedTask,
  restoreTrashedTask,
} from "./task-trash";

// Trash and restore (C7). Deleting goes through the task and project delete
// routes; these list the trash, restore, and delete permanently. Restoring
// needs the same permission as deleting.

const TAGS = ["Trash"];

const listProjectTrashRoute = createRoute({
  method: "get",
  operationId: "listTaskTrash",
  path: "/project/{projectId}/tasks",
  tags: TAGS,
  summary: "List a project's trash",
  description:
    "One page of the tasks deleted from a project, most recently deleted first, with who deleted them and when. Sub-tasks deleted with their parent are counted on the parent (subTaskCount), not listed. Needs task:read.",
  middleware: [
    workspaceAccess.fromProject("projectId", {
      notFoundMessage: "Project not found",
    }),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: trashProjectParam, query: listTrashQuery },
  responses: {
    200: jsonResponse("A page of trashed tasks", trashedTaskListSchema),
    400: errorResponse("Invalid query"),
    403: errorResponse("No workspace access, or missing task:read"),
    404: errorResponse("Project not found, or in the trash"),
  },
});

const emptyProjectTrashRoute = createRoute({
  method: "post",
  operationId: "emptyTaskTrash",
  path: "/project/{projectId}/empty",
  tags: TAGS,
  summary: "Empty a project's trash",
  description:
    "Permanently delete every task in a project's trash, with their comments, attachments, relations and time entries (task.purged is published for each). This cannot be undone. Needs task:delete.",
  middleware: [
    workspaceAccess.fromProject("projectId", {
      notFoundMessage: "Project not found",
    }),
    requireWorkspacePermission({ task: ["delete"] }),
  ] as const,
  request: { params: trashProjectParam },
  responses: {
    200: jsonResponse("How many tasks were deleted", emptyTrashResultSchema),
    403: errorResponse("No workspace access, or missing task:delete"),
    404: errorResponse("Project not found, or in the trash"),
  },
});

const restoreTaskRoute = createRoute({
  method: "post",
  operationId: "restoreTask",
  path: "/task/{taskId}/restore",
  tags: TAGS,
  summary: "Restore a task",
  description:
    "Bring a trashed task back, with the sub-tasks deleted together with it, into its column, or the project's entry column when that column is gone (task.restored is published for each). Sub-tasks deleted separately earlier stay in the trash. Needs task:delete.",
  middleware: [
    workspaceAccess.fromTrashedTask("taskId"),
    requireWorkspacePermission({ task: ["delete"] }),
  ] as const,
  request: { params: trashedTaskParam },
  responses: {
    200: jsonResponse("The restored task", taskSchema),
    403: errorResponse("No workspace access, or missing task:delete"),
    404: errorResponse("Task not found in the trash"),
    409: errorResponse(
      "The task's project is in the trash, or the task was deleted with its parent",
    ),
  },
});

const purgeTaskRoute = createRoute({
  method: "delete",
  operationId: "purgeTask",
  path: "/task/{taskId}",
  tags: TAGS,
  summary: "Delete a task permanently",
  description:
    "Permanently delete a trashed task and the sub-tasks deleted together with it, with their comments, attachments, relations and time entries (task.purged is published for each). This cannot be undone. Needs task:delete.",
  middleware: [
    workspaceAccess.fromTrashedTask("taskId"),
    requireWorkspacePermission({ task: ["delete"] }),
  ] as const,
  request: { params: trashedTaskParam },
  responses: {
    200: jsonResponse("The deleted task", taskSchema),
    403: errorResponse("No workspace access, or missing task:delete"),
    404: errorResponse("Task not found in the trash"),
    409: errorResponse("The task was deleted with its parent"),
  },
});

const listWorkspaceTrashRoute = createRoute({
  method: "get",
  operationId: "listProjectTrash",
  path: "/projects",
  tags: TAGS,
  summary: "List trashed projects",
  description:
    "One page of the workspace's deleted projects, most recently deleted first, with who deleted them, when, and how many tasks went with them. Needs project:read.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: { query: listProjectTrashQuery },
  responses: {
    200: jsonResponse("A page of trashed projects", trashedProjectListSchema),
    400: errorResponse("Invalid query"),
    403: errorResponse("No workspace access, or missing project:read"),
  },
});

const restoreProjectRoute = createRoute({
  method: "post",
  operationId: "restoreProject",
  path: "/projects/{projectId}/restore",
  tags: TAGS,
  summary: "Restore a project",
  description:
    "Bring a trashed project back with the tasks deleted together with it (project.restored is published). Tasks deleted on their own before stay in the project's trash. Needs project:delete.",
  middleware: [
    workspaceAccess.fromTrashedProject("projectId"),
    requireWorkspacePermission({ project: ["delete"] }),
  ] as const,
  request: { params: trashProjectParam },
  responses: {
    200: jsonResponse("The restored project", projectSchema),
    403: errorResponse("No workspace access, or missing project:delete"),
    404: errorResponse("Project not found in the trash"),
  },
});

const purgeProjectRoute = createRoute({
  method: "delete",
  operationId: "purgeProject",
  path: "/projects/{projectId}",
  tags: TAGS,
  summary: "Delete a project permanently",
  description:
    "Permanently delete a trashed project and everything in it (project.purged is published). This cannot be undone. Needs project:delete.",
  middleware: [
    workspaceAccess.fromTrashedProject("projectId"),
    requireWorkspacePermission({ project: ["delete"] }),
  ] as const,
  request: { params: trashProjectParam },
  responses: {
    200: jsonResponse("The deleted project", projectSchema),
    403: errorResponse("No workspace access, or missing project:delete"),
    404: errorResponse("Project not found in the trash"),
  },
});

const trash = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listProjectTrashRoute, async (c) => {
    const project = await liveProjectOf(
      c.req.valid("param").projectId,
      c.get("workspaceId"),
    );
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    return c.json(await listProjectTrash(project, c.req.valid("query")), 200);
  })
  .openapi(emptyProjectTrashRoute, async (c) => {
    const project = await liveProjectOf(
      c.req.valid("param").projectId,
      c.get("workspaceId"),
    );
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    const deletedCount = await emptyProjectTrash(project.id, c.get("userId"));
    return c.json({ deletedCount }, 200);
  })
  .openapi(restoreTaskRoute, async (c) => {
    const task = await restoreTrashedTask(
      c.req.valid("param").taskId,
      c.get("userId"),
    );
    return c.json(task, 200);
  })
  .openapi(purgeTaskRoute, async (c) => {
    const task = await purgeTrashedTask(
      c.req.valid("param").taskId,
      c.get("userId"),
    );
    return c.json(task, 200);
  })
  .openapi(listWorkspaceTrashRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await listWorkspaceTrash(
        query.workspaceId,
        query,
        await requestHiddenProjectIds(c),
      ),
      200,
    );
  })
  .openapi(restoreProjectRoute, async (c) => {
    const project = await restoreTrashedProject(
      c.req.valid("param").projectId,
      c.get("workspaceId"),
      c.get("userId"),
    );
    return c.json(project, 200);
  })
  .openapi(purgeProjectRoute, async (c) => {
    const project = await purgeTrashedProject(
      c.req.valid("param").projectId,
      c.get("workspaceId"),
      c.get("userId"),
    );
    return c.json(project, 200);
  });

export default trash;
