import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { pageTemplateTable } from "../database/schema";
import { createRoute, errorResponse, jsonResponse } from "../openapi";
import { requireProjectFeature } from "../project/features";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { pageRoute } from "./middleware";
import {
  deletedPageTemplateSchema,
  pagePublicationSchema,
  pageTemplateListSchema,
  pageTemplateSchema,
} from "./response";
import {
  pageParam,
  pageTemplateParam,
  projectTemplatesParam,
  savePageTemplateBody,
} from "./schema";
import { TEMPLATE_MESSAGES } from "./templates";

// Page templates and public page links, under /api/page.

const TAGS = ["Pages"];
const NOT_FOUND = "Unknown page, or another user's private page";
const FEATURE_OFF = "the Pages feature is turned off for the page's project";

/**
 * Resolves the template in the path to its workspace and checks access. A
 * template in a workspace the caller can't reach answers 404. Reads the raw
 * param: route middleware runs before the validators.
 */
async function templateAccess(c: Context, next: Next) {
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const templateId = c.req.param("templateId");
  const [row] = templateId
    ? await db
        .select({
          workspaceId: pageTemplateTable.workspaceId,
          projectId: pageTemplateTable.projectId,
        })
        .from(pageTemplateTable)
        .where(eq(pageTemplateTable.id, templateId))
        .limit(1)
    : [];
  if (!row) {
    throw new HTTPException(404, { message: TEMPLATE_MESSAGES.notFound });
  }
  try {
    await validateWorkspaceAccess(
      userId,
      row.workspaceId,
      c.get("apiKey")?.id,
      row.projectId,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      throw new HTTPException(404, { message: TEMPLATE_MESSAGES.notFound });
    }
    throw error;
  }
  c.set("workspaceId", row.workspaceId);
  return next();
}

function jsonBody<T>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

export const listPageTemplatesRoute = createRoute({
  method: "get",
  operationId: "listPageTemplates",
  path: "/project/{projectId}/templates",
  tags: TAGS,
  summary: "List page templates",
  description:
    "Saved templates offered when creating a page in the project: the project's own and the workspace-wide ones, by name. Without content: create a page with templateId to copy one.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ page: ["read"] }),
    requireProjectFeature("pages", { resource: "project", key: "projectId" }),
  ] as const,
  request: { params: projectTemplatesParam },
  responses: {
    200: jsonResponse("The templates", pageTemplateListSchema),
    400: errorResponse("The project could not be found"),
    403: errorResponse(
      "No workspace access, missing page:read, or the project's Pages feature is off",
    ),
  },
});

export const savePageTemplateRoute = createRoute({
  method: "post",
  operationId: "savePageAsTemplate",
  path: "/{id}/template",
  tags: TAGS,
  summary: "Save page as template",
  description:
    "Save the page's current content, title icon included, as a template for its project or for the whole workspace. At most 200 templates per workspace. Needs page:create.",
  middleware: [...pageRoute("create")] as const,
  request: { params: pageParam, body: jsonBody(savePageTemplateBody) },
  responses: {
    200: jsonResponse("The template", pageTemplateSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(`Missing page:create, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
    409: errorResponse("The workspace has 200 templates"),
  },
});

export const deletePageTemplateRoute = createRoute({
  method: "delete",
  operationId: "deletePageTemplate",
  path: "/template/{templateId}",
  tags: TAGS,
  summary: "Delete page template",
  description:
    "Delete a saved template. Pages created from it are not affected. Who saved it (with page:create), or page:delete.",
  middleware: [
    templateAccess,
    requireWorkspacePermission({ page: ["read"] }),
  ] as const,
  request: { params: pageTemplateParam },
  responses: {
    200: jsonResponse("The deleted template", deletedPageTemplateSchema),
    403: errorResponse("Not who saved it, and missing page:delete"),
    404: errorResponse("Unknown template"),
  },
});

export const getPagePublicationRoute = createRoute({
  method: "get",
  operationId: "getPagePublication",
  path: "/{id}/publication",
  tags: TAGS,
  summary: "Get page publication",
  description:
    "Whether the page is published to a read-only public link, the link, and whether the workspace allows public pages.",
  middleware: [...pageRoute("read")] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("The publication", pagePublicationSchema),
    403: errorResponse(`Missing page:read, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
  },
});

export const publishPageRoute = createRoute({
  method: "post",
  operationId: "publishPage",
  path: "/{id}/publish",
  tags: TAGS,
  summary: "Publish page",
  description:
    "Publish the page to a read-only public link with an unguessable token. Anyone with the link can read it without signing in; it is never indexed. Mentions, task and page links and files other than its images are not shown. Needs project:share, a workspace that allows public pages, and a page visible to the workspace. Publishing again keeps the link.",
  middleware: [
    ...pageRoute("read"),
    requireWorkspacePermission({ project: ["share"] }),
  ] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("The publication", pagePublicationSchema),
    403: errorResponse(`Missing project:share, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
    409: errorResponse(
      "Public pages are off for the workspace, or the page is private or archived",
    ),
  },
});

export const unpublishPageRoute = createRoute({
  method: "post",
  operationId: "unpublishPage",
  path: "/{id}/unpublish",
  tags: TAGS,
  summary: "Unpublish page",
  description:
    "Revoke the public link at once: it answers 404 from now on. Publishing again issues a new link. Needs project:share.",
  middleware: [
    ...pageRoute("read"),
    requireWorkspacePermission({ project: ["share"] }),
  ] as const,
  request: { params: pageParam },
  responses: {
    200: jsonResponse("The publication", pagePublicationSchema),
    403: errorResponse(`Missing project:share, or ${FEATURE_OFF}`),
    404: errorResponse(NOT_FOUND),
  },
});
