import type { Context } from "hono";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
} from "../openapi";
import { imageUploadSchema } from "../task/response";
import { normalizeApiServerUrl } from "../utils/openapi-spec";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createAttachmentUpload from "./controllers/create-attachment-upload";
import deleteAttachment from "./controllers/delete-attachment";
import finalizeAttachment from "./controllers/finalize-attachment";
import listTaskAttachments from "./controllers/list-task-attachments";
import {
  taskAttachmentDeleteResultSchema,
  taskAttachmentListSchema,
  taskAttachmentSchema,
} from "./response";
import {
  createAttachmentUploadBody,
  finalizeAttachmentBody,
  taskAttachmentParam,
  taskIdParam,
} from "./schema";

const TAGS = ["Task Attachments"];

const writeAttachments = [
  workspaceAccess.fromTaskId("taskId"),
  requireWorkspacePermission({ task: ["update"] }),
  requireEntitlement,
] as const;

function jsonBody<T>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

/** Where asset URLs point: MARGAYA_API_URL, else this request's origin. */
function apiBaseUrl(c: Context) {
  return normalizeApiServerUrl(
    process.env.MARGAYA_API_URL || new URL(c.req.url).origin,
  );
}

const listTaskAttachmentsRoute = createRoute({
  method: "get",
  operationId: "listTaskAttachments",
  path: "/{taskId}",
  tags: TAGS,
  summary: "List task attachments",
  description:
    "Files attached to a task through its Attachments panel, newest first. Images and files inserted into the description or comments are not listed.",
  middleware: [workspaceAccess.fromTaskId("taskId")] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("The task's attachments", taskAttachmentListSchema),
    403: errorResponse("No access to the task's workspace"),
    404: lookupNotFound("task"),
  },
});

const createAttachmentUploadRoute = createRoute({
  method: "post",
  operationId: "createTaskAttachmentUpload",
  path: "/{taskId}/upload",
  tags: TAGS,
  summary: "Create attachment upload URL",
  description:
    "Step 1 of 3: get a presigned URL. PUT the file's bytes to it with the returned headers, then call the finalize route. Any content type is accepted, up to S3_MAX_IMAGE_UPLOAD_BYTES (10 MB by default) and 100 attachments per task.",
  middleware: [...writeAttachments] as const,
  request: { params: taskIdParam, body: jsonBody(createAttachmentUploadBody) },
  responses: {
    200: jsonResponse("The presigned upload", imageUploadSchema),
    400: errorResponse(
      "Invalid body, the file is too large, or the task has 100 attachments",
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: lookupNotFound("task"),
    503: errorResponse("File uploads are not configured on this instance"),
  },
});

const finalizeAttachmentRoute = createRoute({
  method: "post",
  operationId: "finalizeTaskAttachment",
  path: "/{taskId}/finalize",
  tags: TAGS,
  summary: "Finalize attachment upload",
  description:
    "Step 3 of 3: check the uploaded object and record it as an attachment. Repeating the call with the same key returns the same attachment.",
  middleware: [...writeAttachments] as const,
  request: { params: taskIdParam, body: jsonBody(finalizeAttachmentBody) },
  responses: {
    200: jsonResponse("The attachment", taskAttachmentSchema),
    400: errorResponse(
      "Invalid body, a key of another task, an object that does not match the declared size and type, or the task has 100 attachments",
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
    503: errorResponse(
      "File uploads are not configured, or storage could not be reached",
    ),
  },
});

const deleteAttachmentRoute = createRoute({
  method: "delete",
  operationId: "deleteTaskAttachment",
  path: "/{taskId}/{attachmentId}",
  tags: TAGS,
  summary: "Delete task attachment",
  description:
    "Delete an attachment and its stored file. The uploader can delete their own with task:update; deleting someone else's also needs task:delete.",
  middleware: [...writeAttachments] as const,
  request: { params: taskAttachmentParam },
  responses: {
    200: jsonResponse(
      "The deleted attachment's id",
      taskAttachmentDeleteResultSchema,
    ),
    403: errorResponse(
      "No workspace access, missing task:update permission, or someone else's attachment without task:delete",
    ),
    404: errorResponse(
      "Unknown task, a task in the trash, or one in a project the caller can't see; or the attachment is not on this task",
    ),
  },
});

const taskAttachment = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listTaskAttachmentsRoute, async (c) =>
    c.json(
      await listTaskAttachments(c.req.valid("param").taskId, apiBaseUrl(c)),
      200,
    ),
  )
  .openapi(createAttachmentUploadRoute, async (c) =>
    c.json(
      await createAttachmentUpload({
        taskId: c.req.valid("param").taskId,
        ...c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(finalizeAttachmentRoute, async (c) =>
    c.json(
      await finalizeAttachment({
        taskId: c.req.valid("param").taskId,
        userId: c.get("userId"),
        ...c.req.valid("json"),
        apiBaseUrl: apiBaseUrl(c),
      }),
      200,
    ),
  )
  .openapi(deleteAttachmentRoute, async (c) => {
    const { taskId, attachmentId } = c.req.valid("param");
    return c.json(
      await deleteAttachment({
        taskId,
        attachmentId,
        userId: c.get("userId"),
        canDeleteTasks: () => hasWorkspacePermission(c, { task: ["delete"] }),
      }),
      200,
    );
  });

export default taskAttachment;
