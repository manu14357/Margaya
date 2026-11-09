import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createTaskLink from "./controllers/create-task-link";
import deleteTaskLink from "./controllers/delete-task-link";
import listTaskLinks from "./controllers/list-task-links";
import updateTaskLink from "./controllers/update-task-link";
import {
  taskLinkDeleteResultSchema,
  taskLinkListSchema,
  taskLinkSchema,
} from "./response";
import {
  createTaskLinkBody,
  taskIdParam,
  taskLinkParam,
  updateTaskLinkBody,
} from "./schema";
// Registers the task-detail activity subscribers once, with the API.
import "../task-activity/subscribers";

const TAGS = ["Task Links"];

const writeLinks = [
  workspaceAccess.fromTaskId("taskId"),
  requireWorkspacePermission({ task: ["update"] }),
  requireEntitlement,
] as const;

function jsonBody<T>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

const listTaskLinksRoute = createRoute({
  method: "get",
  operationId: "listTaskLinks",
  path: "/{taskId}",
  tags: TAGS,
  summary: "List task links",
  description:
    "The web links people added to a task, newest first, each with its host and who added it. Integration links (GitHub, Gitea) are listed with the task's external links instead.",
  middleware: [workspaceAccess.fromTaskId("taskId")] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("The task's links", taskLinkListSchema),
    403: errorResponse("No access to the task's workspace"),
    404: lookupNotFound("task"),
  },
});

const createTaskLinkRoute = createRoute({
  method: "post",
  operationId: "createTaskLink",
  path: "/{taskId}",
  tags: TAGS,
  summary: "Add task link",
  description:
    "Add a web link to a task. The URL is normalized first (https is assumed without a scheme), so the same page can't be added twice. At most 100 links per task.",
  middleware: [...writeLinks] as const,
  request: { params: taskIdParam, body: jsonBody(createTaskLinkBody) },
  responses: {
    200: jsonResponse("The added link", taskLinkSchema),
    400: errorResponse(
      "Invalid body, an invalid or unsafe URL, a title over 255 characters, or the 100-link limit",
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: lookupNotFound("task"),
    409: errorResponse("This link is already on this task"),
  },
});

const updateTaskLinkRoute = createRoute({
  method: "patch",
  operationId: "updateTaskLink",
  path: "/{taskId}/{linkId}",
  tags: TAGS,
  summary: "Update task link",
  description:
    "Change a link's URL and/or title; send at least one. Saving the same values changes nothing.",
  middleware: [...writeLinks] as const,
  request: { params: taskLinkParam, body: jsonBody(updateTaskLinkBody) },
  responses: {
    200: jsonResponse("The link after the change", taskLinkSchema),
    400: errorResponse(
      "Nothing to change, an invalid or unsafe URL, or a title over 255 characters",
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse(
      "Unknown task, a task in the trash, or one in a project the caller can't see; or the link is not on this task",
    ),
    409: errorResponse("This link is already on this task"),
  },
});

const deleteTaskLinkRoute = createRoute({
  method: "delete",
  operationId: "deleteTaskLink",
  path: "/{taskId}/{linkId}",
  tags: TAGS,
  summary: "Remove task link",
  description: "Remove a link from a task.",
  middleware: [...writeLinks] as const,
  request: { params: taskLinkParam },
  responses: {
    200: jsonResponse("The removed link's id", taskLinkDeleteResultSchema),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse(
      "Unknown task, a task in the trash, or one in a project the caller can't see; or the link is not on this task",
    ),
  },
});

const taskLink = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listTaskLinksRoute, async (c) =>
    c.json(await listTaskLinks(c.req.valid("param").taskId), 200),
  )
  .openapi(createTaskLinkRoute, async (c) => {
    const { url, title } = c.req.valid("json");
    return c.json(
      await createTaskLink({
        taskId: c.req.valid("param").taskId,
        userId: c.get("userId"),
        url,
        title,
      }),
      200,
    );
  })
  .openapi(updateTaskLinkRoute, async (c) => {
    const { taskId, linkId } = c.req.valid("param");
    const { url, title } = c.req.valid("json");
    return c.json(
      await updateTaskLink({
        taskId,
        linkId,
        userId: c.get("userId"),
        url,
        title,
      }),
      200,
    );
  })
  .openapi(deleteTaskLinkRoute, async (c) => {
    const { taskId, linkId } = c.req.valid("param");
    return c.json(
      await deleteTaskLink({ taskId, linkId, userId: c.get("userId") }),
      200,
    );
  });

export default taskLink;
