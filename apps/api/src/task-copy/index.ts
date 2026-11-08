import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { includeBodyDestination } from "../utils/destination-project";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import copyTask from "./controllers/copy-task";
import { taskCopyResultSchema } from "./response";
import { copyTaskBody, taskIdParam } from "./schema";

const copyTaskRoute = createRoute({
  method: "post",
  operationId: "copyTask",
  path: "/{taskId}",
  tags: ["Tasks"],
  summary: "Make a copy of a task",
  description:
    "Create a new task from an existing one, in its project or another project of the workspace, with a new number at the end of its column. Title, status and priority are always copied (another project gets the column with the same slug, else its entry column; a planned task stays planned). `include` picks the rest. Description images and, when included, attachments are duplicated in storage. Sub-tasks, comments, history, time entries, other relations and integration links are never copied. Needs task:create in the task's project and in the destination; assignees are copied without task:assign. A destination the caller or a project-limited API key can't reach answers 404.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    includeBodyDestination("projectId"),
    requireWorkspacePermission({ task: ["create"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: copyTaskBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The copy, its key and the options not copied",
      taskCopyResultSchema,
    ),
    400: errorResponse(
      "Invalid body, an empty title, a destination without a workflow, a required custom field without a value, or too many description images",
    ),
    403: errorResponse(
      "No workspace access, or missing task:create permission in either project",
    ),
    404: errorResponse(
      "Unknown task or destination project, one in the trash, or one the caller can't see",
    ),
    409: errorResponse(
      "The destination project is archived, or the task is waiting in intake",
    ),
    503: errorResponse("The task's files could not be copied"),
  },
});

const taskCopy = apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  copyTaskRoute,
  async (c) => {
    const { projectId, title, include } = c.req.valid("json");
    return c.json(
      await copyTask({
        taskId: c.req.valid("param").taskId,
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        projectId,
        title,
        include,
      }),
      200,
    );
  },
);

export default taskCopy;
