import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
} from "../openapi";
import { requireProjectFeature } from "../project/features";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { includeBodyDestination } from "../utils/destination-project";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  pageAccess,
  pageRoute,
  requirePagesFeatureForPage,
} from "./middleware";
import {
  deletedPageSchema,
  finalizedAssetSchema,
  imageUploadSchema,
  pageSchema,
  pageSummaryListSchema,
  pageSummarySchema,
  pageVersionDetailSchema,
  pageVersionListSchema,
} from "./response";
import {
  createPageBody,
  finalizePageAssetUploadBody,
  movePageInTreeBody,
  movePageToProjectBody,
  pageAssetUploadBody,
  pageParam,
  pageVersionParam,
  projectPagesParam,
  replacePageContentBody,
  taskPageReferencesParam,
  updatePageAccessBody,
  updatePageBody,
} from "./schema";
import { PAGE_LIMITS } from "./types";

// Route definitions for /api/page. Every route is gated by the project's
// Pages feature; another user's private page answers 404 everywhere.

const TAGS = ["Pages"];
const FEATURE_OFF = "the Pages feature is turned off for the page's project";
const NOT_FOUND = "Unknown page, or another user's private page";
const LOCKED = "The page is locked or archived";

function jsonBody<T>(schema: T, required = true) {
  return { required, content: { "application/json": { schema } } };
}

function projectRoute(permission: "read" | "create") {
  return [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ page: [permission] }),
    requireProjectFeature("pages", { resource: "project", key: "projectId" }),
  ] as const;
}

const bounded = boundedRequestBody(PAGE_LIMITS.requestBodyBytes);

export const listPagesRoute = createRoute({
  method: "get",
  operationId: "listPages",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "List pages",
  description:
    "Every page of the project the caller can see (public pages and their own private ones), archived ones included, without content. Ordered by parentId (top level first), position, then id. Each page carries the caller's capabilities.",
  middleware: [...projectRoute("read")] as const,
  request: { params: projectPagesParam },
  responses: {
    200: jsonResponse("The pages", pageSummaryListSchema),
    403: errorResponse(
      "No workspace access, missing page:read, or the project's Pages feature is off",
    ),
    404: lookupNotFound("project"),
  },
});

export const createPageRoute = createRoute({
  method: "post",
  operationId: "createPage",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Create page",
  description:
    "Create a page owned by the caller, at the end of its siblings or right after afterId. content is markdown (at most 1 MiB); it is stored as a collaborative document and normalized. Under a private parent the page is private, and only that parent's owner may add pages. At most 5 levels deep and 5,000 pages per project.",
  middleware: [bounded, ...projectRoute("create"), requireEntitlement] as const,
  request: { params: projectPagesParam, body: jsonBody(createPageBody, false) },
  responses: {
    200: jsonResponse("The new page", pageSchema),
    400: errorResponse(
      "Invalid body, an invalid icon or emoji, a parent in another project, too deep, or afterId is not a sibling",
    ),
    403: errorResponse(
      "No workspace access, missing page:create, or the project's Pages feature is off",
    ),
    404: errorResponse("Parent page or template not found"),
    409: errorResponse(
      "The parent is archived or someone else's private page, or the project has 5,000 pages",
    ),
    413: errorResponse("The content is too large"),
  },
});

export const getPageRoute = createRoute({
  method: "get",
  operationId: "getPage",
  path: "/{id}",
  tags: TAGS,
  summary: "Get page",
  description:
    "One page with its markdown content (the last saved projection, which can lag live edits by up to 10 seconds), its content version, visible ancestors and the caller's capabilities.",
  middleware: [...pageRoute("read")] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("The page", pageSchema),
    403: errorResponse(`Missing page:read, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
  },
});

export const updatePageRoute = createRoute({
  method: "patch",
  operationId: "updatePage",
  path: "/{id}",
  tags: TAGS,
  summary: "Update page",
  description:
    "Change the title, the logo (logoKind and logoValue together; both null removes it) or the full-width setting. Needs canEdit: not locked or archived, and public or the caller's own. Unchanged values publish nothing.",
  middleware: [...pageRoute("update"), requireEntitlement] as const,
  request: { params: pageParam, body: jsonBody(updatePageBody) },
  responses: {
    200: jsonResponse("The page", pageSchema),
    400: errorResponse(
      "An empty body, an unknown field, or an invalid icon or emoji",
    ),
    403: errorResponse(
      `Missing page:update, not editable by the caller, or ${FEATURE_OFF}`,
    ),
    404: errorResponse(NOT_FOUND),
    409: errorResponse(LOCKED),
  },
});

export const replacePageContentRoute = createRoute({
  method: "put",
  operationId: "replacePageContent",
  path: "/{id}/content",
  tags: TAGS,
  summary: "Replace page content",
  description:
    "Replace the whole content with markdown (at most 1 MiB). The change is diffed into the collaborative document, so people editing the page see it like any edit, and it is saved at once (a version is recorded).",
  middleware: [bounded, ...pageRoute("update"), requireEntitlement] as const,
  request: { params: pageParam, body: jsonBody(replacePageContentBody) },
  responses: {
    200: jsonResponse("The page", pageSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      `Missing page:update, not editable by the caller, or ${FEATURE_OFF}`,
    ),
    404: errorResponse(NOT_FOUND),
    409: errorResponse(LOCKED),
    413: errorResponse("The content is too large"),
  },
});

export const movePageInTreeRoute = createRoute({
  method: "put",
  operationId: "movePageInTree",
  path: "/{id}/position",
  tags: TAGS,
  summary: "Move page in tree",
  description:
    "Move a page and its sub-pages under another parent of the same project (null: top level), right after afterId (null or omitted: first). Siblings are renumbered. At most 5 levels; never into its own sub-pages; under a private parent only the caller's own pages, which become private.",
  middleware: [...pageRoute("update"), requireEntitlement] as const,
  request: { params: pageParam, body: jsonBody(movePageInTreeBody) },
  responses: {
    200: jsonResponse("The moved page", pageSummarySchema),
    400: errorResponse(
      "Too deep, inside itself, a parent in another project, or afterId is not a sibling",
    ),
    403: errorResponse(
      `Missing page:update, not editable by the caller, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Unknown or invisible page or parent"),
    409: errorResponse(
      "Locked or archived page, archived parent, or someone else's page under a private parent",
    ),
  },
});

function lockRoute(method: "post" | "delete", locked: boolean) {
  return createRoute({
    method,
    operationId: locked ? "lockPage" : "unlockPage",
    path: "/{id}/lock",
    tags: TAGS,
    summary: locked ? "Lock page" : "Unlock page",
    description: locked
      ? "Make a page read-only for everyone, its owner included, until it is unlocked. Owner or page:delete. Locking a locked page changes nothing."
      : "Allow changes to a locked page again. Owner or page:delete. Unlocking an unlocked page changes nothing.",
    middleware: [...pageRoute("update"), requireEntitlement] as const,
    request: { params: pageParam },
    responses: {
      200: jsonResponse("The page", pageSchema),
      403: errorResponse(`Not the owner or an admin, or ${FEATURE_OFF}`),
      404: errorResponse(NOT_FOUND),
    },
  });
}

export const lockPageRoute = lockRoute("post", true);
export const unlockPageRoute = lockRoute("delete", false);

export const updatePageAccessRoute = createRoute({
  method: "put",
  operationId: "updatePageAccess",
  path: "/{id}/access",
  tags: TAGS,
  summary: "Change page access",
  description:
    "Owner only. private hides the page and all its sub-pages (which must all be the owner's) from everyone else, admins included, and removes them from their favorites and recent visits. public applies to this page only, and never under a private parent.",
  middleware: [...pageRoute("update"), requireEntitlement] as const,
  request: { params: pageParam, body: jsonBody(updatePageAccessBody) },
  responses: {
    200: jsonResponse("The page", pageSchema),
    403: errorResponse(`Not the owner, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
    409: errorResponse(
      "Archived, a private parent, or sub-pages of other people",
    ),
  },
});

function archiveRoute(archived: boolean) {
  return createRoute({
    method: "post",
    operationId: archived ? "archivePage" : "unarchivePage",
    path: archived ? "/{id}/archive" : "/{id}/unarchive",
    tags: TAGS,
    summary: archived ? "Archive page" : "Restore page",
    description: archived
      ? "Archive a page and all its sub-pages. Owner or page:delete. Works without an active subscription."
      : "Restore an archived page and its sub-pages. When its parent is still archived, it moves to the top level. Owner or page:delete.",
    middleware: archived
      ? ([...pageRoute("update")] as const)
      : ([...pageRoute("update"), requireEntitlement] as const),
    request: { params: pageParam },
    responses: {
      200: jsonResponse("The page", pageSchema),
      403: errorResponse(`Not the owner or an admin, or ${FEATURE_OFF}`),
      404: errorResponse(NOT_FOUND),
    },
  });
}

export const archivePageRoute = archiveRoute(true);
export const unarchivePageRoute = archiveRoute(false);

export const deletePageRoute = createRoute({
  method: "delete",
  operationId: "deletePage",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete page",
  description:
    "Move an archived page to the trash: its owner with page:update, or page:delete. Its sub-pages move to the top level (still archived). It can be restored or deleted permanently through the Trash routes until TRASH_RETENTION_DAYS have passed.",
  middleware: [...pageRoute("read")] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("The deleted page", deletedPageSchema),
    403: errorResponse(`Not the owner or an admin, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
    409: errorResponse("The page is not archived"),
  },
});

export const duplicatePageRoute = createRoute({
  method: "post",
  operationId: "duplicatePage",
  path: "/{id}/duplicate",
  tags: TAGS,
  summary: "Duplicate page",
  description:
    'Copy a page (not its sub-pages) as "{title} (copy)", owned by the caller, right after the source, unlocked, with its current content. Versions are not copied.',
  middleware: [...pageRoute("create"), requireEntitlement] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("The copy", pageSchema),
    403: errorResponse(`Missing page:create, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
    409: errorResponse("The project has 5,000 pages"),
  },
});

export const movePageToProjectRoute = createRoute({
  method: "post",
  operationId: "movePageToProject",
  path: "/{id}/move",
  tags: TAGS,
  summary: "Move page to project",
  description:
    "Move a page and all its sub-pages to another project of the workspace with Pages on, as its last top-level page. Owner or page:delete, with page:update in both projects; not while locked or archived. A destination the caller or a project-limited API key can't reach answers 404.",
  middleware: [
    pageAccess(),
    includeBodyDestination("projectId"),
    requireWorkspacePermission({ page: ["update"] }),
    requirePagesFeatureForPage,
    requireEntitlement,
  ] as const,
  request: { params: pageParam, body: jsonBody(movePageToProjectBody) },
  responses: {
    200: jsonResponse("The moved page", pageSchema),
    400: errorResponse("The page is already in that project"),
    403: errorResponse(
      "Not the owner or an admin, missing page:update in either project, or Pages is off in either project",
    ),
    404: errorResponse(
      "Unknown page, or the project is not an active project of the workspace",
    ),
    409: errorResponse("Locked or archived, or the target has 5,000 pages"),
  },
});

export const listPageVersionsRoute = createRoute({
  method: "get",
  operationId: "listPageVersions",
  path: "/{id}/versions",
  tags: TAGS,
  summary: "List page versions",
  description:
    "Saved versions, newest first (at most 20). Saves by the same person within 10 minutes update their newest version.",
  middleware: [...pageRoute("read")] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("The versions", pageVersionListSchema),
    403: errorResponse(`Missing page:read, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
  },
});

export const getPageVersionRoute = createRoute({
  method: "get",
  operationId: "getPageVersion",
  path: "/{id}/versions/{versionId}",
  tags: TAGS,
  summary: "Get page version",
  description: "One version with its content as editor JSON and markdown.",
  middleware: [...pageRoute("read")] as const,
  request: { params: pageVersionParam },
  responses: {
    200: jsonResponse("The version", pageVersionDetailSchema),
    403: errorResponse(`Missing page:read, or ${FEATURE_OFF}`),
    404: errorResponse("Unknown page or version"),
  },
});

export const restorePageVersionRoute = createRoute({
  method: "post",
  operationId: "restorePageVersion",
  path: "/{id}/versions/{versionId}/restore",
  tags: TAGS,
  summary: "Restore page version",
  description:
    "Save the current content as a new version, then make the content that version's. People editing the page receive it like any edit. Needs canEdit.",
  middleware: [...pageRoute("update"), requireEntitlement] as const,
  request: { params: pageVersionParam },
  responses: {
    200: jsonResponse("The page", pageSchema),
    403: errorResponse(
      `Missing page:update, not editable by the caller, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Unknown page or version"),
    409: errorResponse(LOCKED),
    413: errorResponse("The content is too large"),
  },
});

export const listPageBacklinksRoute = createRoute({
  method: "get",
  operationId: "listPageBacklinks",
  path: "/{id}/backlinks",
  tags: TAGS,
  summary: "List page backlinks",
  description:
    "Pages linking to this page that the caller can see, not archived, in projects with Pages on.",
  middleware: [...pageRoute("read")] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("The linking pages", pageSummaryListSchema),
    403: errorResponse(`Missing page:read, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
  },
});

export const listTaskPageReferencesRoute = createRoute({
  method: "get",
  operationId: "listTaskPageReferences",
  path: "/task/{taskId}/references",
  tags: TAGS,
  summary: "List pages linking a task",
  description:
    "Pages that link to the task, visible to the caller, not archived, in projects of the workspace with Pages on.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ page: ["read"] }),
  ] as const,
  request: { params: taskPageReferencesParam },
  responses: {
    200: jsonResponse("The linking pages", pageSummaryListSchema),
    403: errorResponse("No workspace access, or missing page:read"),
    404: lookupNotFound("task"),
  },
});

export const createPageAssetUploadRoute = createRoute({
  method: "put",
  operationId: "createPageAssetUpload",
  path: "/{id}/asset-upload",
  tags: TAGS,
  summary: "Create page file upload URL",
  description:
    "Get a presigned URL for an image or file used in the page. PUT the bytes to it, then call the finalize route. Needs canEdit.",
  middleware: [...pageRoute("update"), requireEntitlement] as const,
  request: { params: pageParam, body: jsonBody(pageAssetUploadBody) },
  responses: {
    200: jsonResponse("The presigned upload", imageUploadSchema),
    400: errorResponse("Unsupported content type, or the file is too large"),
    403: errorResponse(
      `Missing page:update, not editable by the caller, or ${FEATURE_OFF}`,
    ),
    404: errorResponse(NOT_FOUND),
    409: errorResponse(LOCKED),
    503: errorResponse("Uploads are not configured on this instance"),
  },
});

export const finalizePageAssetUploadRoute = createRoute({
  method: "post",
  operationId: "finalizePageAssetUpload",
  path: "/{id}/asset-upload/finalize",
  tags: TAGS,
  summary: "Finalize page file upload",
  description:
    "Record an uploaded file as a private asset of the page and return the URL to reference it by. Files of a private page are readable by its owner only.",
  middleware: [...pageRoute("update"), requireEntitlement] as const,
  request: { params: pageParam, body: jsonBody(finalizePageAssetUploadBody) },
  responses: {
    200: jsonResponse("The stored file", finalizedAssetSchema),
    400: errorResponse(
      "Invalid upload, or the key does not belong to this page",
    ),
    403: errorResponse(
      `Missing page:update, not editable by the caller, or ${FEATURE_OFF}`,
    ),
    404: errorResponse(NOT_FOUND),
    409: errorResponse(LOCKED),
    503: errorResponse(
      "Uploads are not configured, or the upload could not be verified",
    ),
  },
});
