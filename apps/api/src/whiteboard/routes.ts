import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
} from "../openapi";
import { requireProjectFeature } from "../project/features";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  projectFromQuery,
  requireWhiteboardsFeature,
  whiteboardRoute,
} from "./middleware";
import {
  deletedWhiteboardSchema,
  whiteboardActivityPageSchema,
  whiteboardAssetSchema,
  whiteboardAssetUploadSchema,
  whiteboardContentSchema,
  whiteboardElementsResultSchema,
  whiteboardListSchema,
  whiteboardPublicationSchema,
  whiteboardSchema,
  workspaceWhiteboardListSchema,
} from "./response";
import { WHITEBOARD_LIMITS } from "./rules";
import {
  addWhiteboardElementsBody,
  createWhiteboardBody,
  duplicateWhiteboardBody,
  finalizeWhiteboardAssetBody,
  listWhiteboardsQuery,
  listWorkspaceWhiteboardsQuery,
  taskWhiteboardsParam,
  updateWhiteboardBody,
  whiteboardActivityQuery,
  whiteboardAssetParam,
  whiteboardAssetUploadBody,
  whiteboardParam,
  workspaceWhiteboardsParam,
} from "./schema";

// Route definitions for /api/whiteboard. Every route is gated by the
// project's Whiteboards feature; a board in another workspace, the trash or
// a restricted project the caller can't see answers 404.

const TAGS = ["Whiteboards"];
const FEATURE_OFF =
  "the Whiteboards feature is turned off for the board's project";
const NOT_FOUND =
  "Unknown whiteboard, one in the trash, or one in a project the caller can't see";
const LOCKED = "The whiteboard is locked or archived";

function jsonBody<T>(schema: T, required = true) {
  return { required, content: { "application/json": { schema } } };
}

const bounded = boundedRequestBody(WHITEBOARD_LIMITS.requestBodyBytes);

export const listWhiteboardsRoute = createRoute({
  method: "get",
  operationId: "listWhiteboards",
  path: "/",
  tags: TAGS,
  summary: "List whiteboards",
  description:
    "A project's whiteboards without their content, most recently updated first. Live boards by default, archived ones with archived=true; q matches the title and the text on the board. Needs whiteboard:read and the project's Whiteboards feature.",
  middleware: [
    projectFromQuery(),
    requireWorkspacePermission({ whiteboard: ["read"] }),
    requireWhiteboardsFeature,
  ] as const,
  request: { query: listWhiteboardsQuery },
  responses: {
    200: jsonResponse("The whiteboards", whiteboardListSchema),
    400: errorResponse("Invalid query"),
    403: errorResponse(
      "No workspace access, missing whiteboard:read, or the project's Whiteboards feature is off",
    ),
    404: lookupNotFound("project"),
  },
});

export const createWhiteboardRoute = createRoute({
  method: "post",
  operationId: "createWhiteboard",
  path: "/",
  tags: TAGS,
  summary: "Create whiteboard",
  description:
    "Create a whiteboard in a project, blank or with starting elements (a template). Elements are validated like any edit: unknown fields are dropped, values clamped, and elements that can't be repaired are skipped. Needs whiteboard:create. At most 5,000 boards per project.",
  middleware: [
    bounded,
    workspaceAccess.fromProject("projectId", {
      notFoundMessage: "Project not found",
    }),
    requireWorkspacePermission({ whiteboard: ["create"] }),
    requireProjectFeature("whiteboards", {
      resource: "project",
      key: "projectId",
      in: "body",
    }),
    requireEntitlement,
  ] as const,
  request: { body: jsonBody(createWhiteboardBody) },
  responses: {
    201: jsonResponse("The new whiteboard", whiteboardSchema),
    400: errorResponse("Invalid body, or the icon is not a single emoji"),
    403: errorResponse(
      "No workspace access, missing whiteboard:create, or the project's Whiteboards feature is off",
    ),
    404: lookupNotFound("project"),
    409: errorResponse("The project has 5,000 whiteboards"),
    413: errorResponse("The body or the content is too large"),
  },
});

export const listTaskWhiteboardsRoute = createRoute({
  method: "get",
  operationId: "listTaskWhiteboards",
  path: "/by-task/{taskId}",
  tags: TAGS,
  summary: "List whiteboards showing a task",
  description:
    "Live whiteboards that hold a card for the task, as of their last save. Needs whiteboard:read and the Whiteboards feature of the task's project.",
  middleware: [
    workspaceAccess.fromTaskId("taskId", { notFoundMessage: "Task not found" }),
    requireWorkspacePermission({ whiteboard: ["read"] }),
    requireProjectFeature("whiteboards", { resource: "task", key: "taskId" }),
  ] as const,
  request: { params: taskWhiteboardsParam },
  responses: {
    200: jsonResponse("The whiteboards", whiteboardListSchema),
    403: errorResponse(
      "No workspace access, missing whiteboard:read, or the project's Whiteboards feature is off",
    ),
    404: lookupNotFound("task"),
  },
});

export const listWorkspaceWhiteboardsRoute = createRoute({
  method: "get",
  operationId: "listWorkspaceWhiteboards",
  path: "/workspace/{workspaceId}",
  tags: TAGS,
  summary: "List the workspace's whiteboards",
  description: `Boards of every project the caller can see that has the Whiteboards feature on and is not in the trash, each with its project, most recently updated first and at most ${WHITEBOARD_LIMITS.workspaceListSize.toLocaleString("en-US")}. Live boards by default, archived ones with archived=true; q matches the title and the text on the board. Restricted projects the caller can't see, and projects whose project role withholds whiteboard:read, are left out. Needs whiteboard:read.`,
  middleware: [
    workspaceAccess.fromParam(),
    requireWorkspacePermission({ whiteboard: ["read"] }),
  ] as const,
  request: {
    params: workspaceWhiteboardsParam,
    query: listWorkspaceWhiteboardsQuery,
  },
  responses: {
    200: jsonResponse(
      "The whiteboards with their projects",
      workspaceWhiteboardListSchema,
    ),
    400: errorResponse("Invalid query"),
    403: errorResponse("No workspace access, or missing whiteboard:read"),
  },
});

export const getWhiteboardRoute = createRoute({
  method: "get",
  operationId: "getWhiteboard",
  path: "/{id}",
  tags: TAGS,
  summary: "Get whiteboard",
  description:
    "One whiteboard without its content, with the caller's capabilities. publicToken is only shown to callers who can manage the board. Needs whiteboard:read.",
  middleware: [...whiteboardRoute("read")] as const,
  request: { params: whiteboardParam },
  responses: {
    200: jsonResponse("The whiteboard", whiteboardSchema),
    403: errorResponse(`Missing whiteboard:read, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
  },
});

export const listWhiteboardActivityRoute = createRoute({
  method: "get",
  operationId: "listWhiteboardActivity",
  path: "/{id}/activity",
  tags: TAGS,
  summary: "List whiteboard activity",
  description:
    "The board's history, newest first, 50 entries a page: created, renamed, icon changed, locked, unlocked, archived, unarchived, published, unpublished, moved to the trash and restored, plus edited (at most one entry per person every 10 minutes). Entries name who and when, never content. Needs whiteboard:read.",
  middleware: [...whiteboardRoute("read")] as const,
  request: { params: whiteboardParam, query: whiteboardActivityQuery },
  responses: {
    200: jsonResponse(
      "A page of the board's history",
      whiteboardActivityPageSchema,
    ),
    400: errorResponse("Invalid cursor"),
    403: errorResponse(`Missing whiteboard:read, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
  },
});

export const updateWhiteboardRoute = createRoute({
  method: "patch",
  operationId: "updateWhiteboard",
  path: "/{id}",
  tags: TAGS,
  summary: "Update whiteboard",
  description:
    "Rename the board or change its icon (one emoji, or null to remove it). Needs whiteboard:update on a board that is not locked or archived. Unchanged values publish nothing.",
  middleware: [...whiteboardRoute("update"), requireEntitlement] as const,
  request: { params: whiteboardParam, body: jsonBody(updateWhiteboardBody) },
  responses: {
    200: jsonResponse("The whiteboard", whiteboardSchema),
    400: errorResponse(
      "An empty body, an unknown field, or an icon that is not a single emoji",
    ),
    403: errorResponse(`Missing whiteboard:update, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
    409: errorResponse(LOCKED),
  },
});

export const deleteWhiteboardRoute = createRoute({
  method: "delete",
  operationId: "deleteWhiteboard",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete whiteboard",
  description:
    "Move an archived whiteboard to the project's trash, closing its live sessions and revoking its public link. The board's creator with whiteboard:update, or whiteboard:delete. Restore or delete it for good through the trash routes.",
  middleware: [...whiteboardRoute("read")] as const,
  request: { params: whiteboardParam },
  responses: {
    200: jsonResponse("The deleted whiteboard", deletedWhiteboardSchema),
    403: errorResponse(
      `Not the board's creator with whiteboard:update and no whiteboard:delete, or ${FEATURE_OFF}`,
    ),
    404: errorResponse(NOT_FOUND),
    409: errorResponse("The whiteboard is not archived"),
  },
});

export const getWhiteboardContentRoute = createRoute({
  method: "get",
  operationId: "getWhiteboardContent",
  path: "/{id}/content",
  tags: TAGS,
  summary: "Get whiteboard content",
  description:
    "The board's live elements (deleted ones left out) and settings. With a live session on this server the answer includes unsaved edits; otherwise it is the last saved content, which can lag live edits by up to 10 seconds. Needs whiteboard:read.",
  middleware: [...whiteboardRoute("read")] as const,
  request: { params: whiteboardParam },
  responses: {
    200: jsonResponse("The content", whiteboardContentSchema),
    403: errorResponse(`Missing whiteboard:read, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
  },
});

export const addWhiteboardElementsRoute = createRoute({
  method: "post",
  operationId: "addWhiteboardElements",
  path: "/{id}/elements",
  tags: TAGS,
  summary: "Add whiteboard elements",
  description:
    "Add elements to the board, or replace elements with the same ids. Elements are validated (invalid ones are skipped and counted) and written with versions above the board's, so they win; people with the board open see them at once, and the change is saved immediately. Needs whiteboard:update on a board that is not locked or archived.",
  middleware: [
    bounded,
    ...whiteboardRoute("update"),
    requireEntitlement,
  ] as const,
  request: {
    params: whiteboardParam,
    body: jsonBody(addWhiteboardElementsBody),
  },
  responses: {
    200: jsonResponse("The written elements", whiteboardElementsResultSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(`Missing whiteboard:update, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
    409: errorResponse(`${LOCKED}, or it holds the most elements a board may`),
    413: errorResponse("The body or the board is too large"),
  },
});

export const getWhiteboardPreviewRoute = createRoute({
  method: "get",
  operationId: "getWhiteboardPreview",
  path: "/{id}/preview.svg",
  tags: TAGS,
  summary: "Get whiteboard preview",
  description:
    "A standalone SVG image of the board for list thumbnails, with live task cards. Images on the board show as placeholders. Cached privately for 60 seconds; add ?v=<contentVersion> to bust the cache. Needs whiteboard:read.",
  middleware: [...whiteboardRoute("read")] as const,
  request: { params: whiteboardParam },
  responses: {
    200: {
      description: "The SVG image",
      content: { "image/svg+xml": { schema: { type: "string" } } },
    },
    403: errorResponse(`Missing whiteboard:read, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
  },
});

export const duplicateWhiteboardRoute = createRoute({
  method: "post",
  operationId: "duplicateWhiteboard",
  path: "/{id}/duplicate",
  tags: TAGS,
  summary: "Duplicate whiteboard",
  description:
    "Copy the board's content (unsaved live edits on this server included) into a new board in the same project. The title is taken as sent, or the source's title; nothing is appended. Needs whiteboard:read and whiteboard:create.",
  middleware: [
    bounded,
    ...whiteboardRoute("read"),
    requireWorkspacePermission({ whiteboard: ["create"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: whiteboardParam,
    body: jsonBody(duplicateWhiteboardBody, false),
  },
  responses: {
    201: jsonResponse("The copy", whiteboardSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(`Missing whiteboard:create, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
    409: errorResponse("The project has 5,000 whiteboards"),
  },
});

function lockRoute(locked: boolean) {
  return createRoute({
    method: locked ? "post" : "delete",
    operationId: locked ? "lockWhiteboard" : "unlockWhiteboard",
    path: "/{id}/lock",
    tags: TAGS,
    summary: locked ? "Lock whiteboard" : "Unlock whiteboard",
    description: locked
      ? "Make the board read-only for everyone, its creator included; live sessions switch to read-only at once. The board's creator with whiteboard:update, or whiteboard:delete."
      : "Make a locked board editable again. The board's creator with whiteboard:update, or whiteboard:delete.",
    middleware: [...whiteboardRoute("read")] as const,
    request: { params: whiteboardParam },
    responses: {
      200: jsonResponse("The whiteboard", whiteboardSchema),
      403: errorResponse(
        `Not the board's creator with whiteboard:update and no whiteboard:delete, or ${FEATURE_OFF}`,
      ),
      404: errorResponse(NOT_FOUND),
    },
  });
}

export const lockWhiteboardRoute = lockRoute(true);
export const unlockWhiteboardRoute = lockRoute(false);

function archiveRoute(archived: boolean) {
  return createRoute({
    method: "post",
    operationId: archived ? "archiveWhiteboard" : "unarchiveWhiteboard",
    path: archived ? "/{id}/archive" : "/{id}/unarchive",
    tags: TAGS,
    summary: archived ? "Archive whiteboard" : "Unarchive whiteboard",
    description: archived
      ? "Archive the board: it becomes read-only, leaves the list and its public link is revoked. The board's creator with whiteboard:update, or whiteboard:delete."
      : "Bring an archived board back to the list. Its public link stays revoked. The board's creator with whiteboard:update, or whiteboard:delete.",
    middleware: [...whiteboardRoute("read")] as const,
    request: { params: whiteboardParam },
    responses: {
      200: jsonResponse("The whiteboard", whiteboardSchema),
      403: errorResponse(
        `Not the board's creator with whiteboard:update and no whiteboard:delete, or ${FEATURE_OFF}`,
      ),
      404: errorResponse(NOT_FOUND),
    },
  });
}

export const archiveWhiteboardRoute = archiveRoute(true);
export const unarchiveWhiteboardRoute = archiveRoute(false);

function publicationRoute(publish: boolean) {
  return createRoute({
    method: publish ? "post" : "delete",
    operationId: publish ? "publishWhiteboard" : "unpublishWhiteboard",
    path: "/{id}/publication",
    tags: TAGS,
    summary: publish ? "Publish whiteboard" : "Unpublish whiteboard",
    description: publish
      ? "Publish a read-only public link to the board, readable without signing in at /public-whiteboard/{token}. Every publish issues a new token, revoking the previous one. Needs whiteboard:delete and the workspace's public pages setting; the board must not be archived."
      : "Revoke the board's public link. Needs whiteboard:delete.",
    middleware: [...whiteboardRoute("read")] as const,
    request: { params: whiteboardParam },
    responses: {
      200: jsonResponse("The publication", whiteboardPublicationSchema),
      403: errorResponse(`Missing whiteboard:delete, or ${FEATURE_OFF}`),
      404: errorResponse(NOT_FOUND),
      ...(publish
        ? {
            409: errorResponse(
              "The workspace doesn't allow public pages, or the board is archived",
            ),
          }
        : {}),
    },
  });
}

export const publishWhiteboardRoute = publicationRoute(true);
export const unpublishWhiteboardRoute = publicationRoute(false);

export const createWhiteboardAssetUploadRoute = createRoute({
  method: "post",
  operationId: "createWhiteboardAssetUpload",
  path: "/{id}/assets",
  tags: TAGS,
  summary: "Create whiteboard image upload",
  description:
    "Get an image id and a URL to PUT a PNG, JPEG, GIF or WebP image to (the instance's upload size limit applies), then call the finalize route. Needs whiteboard:update on a board that is not locked or archived.",
  middleware: [...whiteboardRoute("update"), requireEntitlement] as const,
  request: {
    params: whiteboardParam,
    body: jsonBody(whiteboardAssetUploadBody),
  },
  responses: {
    200: jsonResponse("The upload", whiteboardAssetUploadSchema),
    400: errorResponse("Unsupported image type, or the file is too large"),
    403: errorResponse(`Missing whiteboard:update, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
    409: errorResponse(LOCKED),
    503: errorResponse("Uploads are not configured on this instance"),
  },
});

export const finalizeWhiteboardAssetRoute = createRoute({
  method: "post",
  operationId: "finalizeWhiteboardAsset",
  path: "/{id}/assets/{assetId}/finalize",
  tags: TAGS,
  summary: "Finalize whiteboard image upload",
  description:
    "Check the uploaded image (its size, declared type and its bytes: only real PNG, JPEG, GIF and WebP files are kept) and record it on the board. Finalizing again returns the same image. Needs whiteboard:update on a board that is not locked or archived.",
  middleware: [...whiteboardRoute("update"), requireEntitlement] as const,
  request: {
    params: whiteboardAssetParam,
    body: jsonBody(finalizeWhiteboardAssetBody),
  },
  responses: {
    200: jsonResponse("The image", whiteboardAssetSchema),
    400: errorResponse(
      "The upload is missing, doesn't match the declared size or type, or is not one of the allowed image types",
    ),
    403: errorResponse(`Missing whiteboard:update, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
    409: errorResponse(LOCKED),
    503: errorResponse(
      "Uploads are not configured, or the upload could not be verified",
    ),
  },
});

export const getWhiteboardAssetRoute = createRoute({
  method: "get",
  operationId: "getWhiteboardAsset",
  path: "/{id}/assets/{assetId}",
  tags: TAGS,
  summary: "Get whiteboard image",
  description:
    "Download an image of the board. Needs whiteboard:read; archived boards' images stay readable.",
  middleware: [...whiteboardRoute("read")] as const,
  request: { params: whiteboardAssetParam },
  responses: {
    200: {
      description: "The image",
      content: { "image/*": { schema: { type: "string", format: "binary" } } },
    },
    403: errorResponse(`Missing whiteboard:read, or ${FEATURE_OFF}`),
    404: errorResponse(`${NOT_FOUND}, or not an image of this board`),
  },
});
