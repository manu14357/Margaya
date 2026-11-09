import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  createReport,
  deleteReport,
  getReport,
  listReports,
  REPORT_NOT_FOUND,
  type ReportViewer,
  updateReport,
  visibleReportScope,
} from "./reports";
import {
  analyticsReportListSchema,
  analyticsReportSchema,
  deletedReportSchema,
} from "./response";
import {
  createReportBody,
  listReportsQuery,
  reportParam,
  updateReportBody,
} from "./schema";

// Saved analytics reports, guarded like the analytics routes themselves
// (analytics:read and task:read). Nothing here publishes events: reports
// are personal or settings-level data and need no realtime delivery.

const TAGS = ["Analytics"];
const READ = { analytics: ["read"], task: ["read"] };
const FORBIDDEN =
  "No workspace access, or missing analytics:read or task:read permission";

/**
 * Resolves the report in the path: 404 when unknown or another user's
 * private report (its existence is not revealed), then workspace access.
 * Reads the raw param: route middleware runs before the validators.
 */
async function reportAccess(c: Context, next: Next) {
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const scope = await visibleReportScope(c.req.param("id") ?? "", userId);
  if (!scope) throw new HTTPException(404, { message: REPORT_NOT_FOUND });
  await validateWorkspaceAccess(userId, scope.workspaceId, c.get("apiKey")?.id);
  c.set("workspaceId", scope.workspaceId);
  return next();
}

function jsonBody<T>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

const listRoute = createRoute({
  method: "get",
  operationId: "listAnalyticsReports",
  path: "/",
  tags: TAGS,
  summary: "List saved analytics reports",
  description:
    "The workspace's shared reports plus the caller's private ones, by name (at most 500).",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission(READ),
  ] as const,
  request: { query: listReportsQuery },
  responses: {
    200: jsonResponse("The reports", analyticsReportListSchema),
    400: errorResponse("Invalid query"),
    403: errorResponse(FORBIDDEN),
  },
});

const getRoute = createRoute({
  method: "get",
  operationId: "getAnalyticsReport",
  path: "/{id}",
  tags: TAGS,
  summary: "Get a saved analytics report",
  description:
    "A shared report, or one of the caller's private ones, with its chart-builder configuration. Scope projects that are gone or in the trash are left out and counted in droppedProjectCount; ones hidden from the caller are left out without being counted.",
  middleware: [reportAccess, requireWorkspacePermission(READ)] as const,
  request: { params: reportParam },
  responses: {
    200: jsonResponse("The report", analyticsReportSchema),
    403: errorResponse(FORBIDDEN),
    404: errorResponse("Unknown report, or another user's private report"),
  },
});

const createReportRoute = createRoute({
  method: "post",
  operationId: "createAnalyticsReport",
  path: "/",
  tags: TAGS,
  summary: "Save an analytics report",
  description:
    "Saves a chart-builder configuration owned by the caller, private unless visibility is workspace. Scope projects must be live projects of the workspace. At most 100 reports per owner and workspace.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission(READ),
  ] as const,
  request: { body: jsonBody(createReportBody) },
  responses: {
    200: jsonResponse("The saved report", analyticsReportSchema),
    400: errorResponse("Invalid body, or 100 reports already"),
    403: errorResponse(FORBIDDEN),
    404: errorResponse("A project id is not in the workspace"),
  },
});

const updateReportRoute = createRoute({
  method: "patch",
  operationId: "updateAnalyticsReport",
  path: "/{id}",
  tags: TAGS,
  summary: "Update a saved analytics report",
  description:
    "Rename it, change its visibility or its configuration. Owner only.",
  middleware: [reportAccess, requireWorkspacePermission(READ)] as const,
  request: { params: reportParam, body: jsonBody(updateReportBody) },
  responses: {
    200: jsonResponse("The report after the change", analyticsReportSchema),
    400: errorResponse("Invalid body, or nothing to change"),
    403: errorResponse(`${FORBIDDEN}, or not the report's owner`),
    404: errorResponse(
      "Unknown report, another user's private report, or a scope project not in the workspace",
    ),
  },
});

const deleteReportRoute = createRoute({
  method: "delete",
  operationId: "deleteAnalyticsReport",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete a saved analytics report",
  description:
    "The owner can delete it; a workspace report can also be deleted by someone with workspace:manage_settings.",
  middleware: [reportAccess, requireWorkspacePermission(READ)] as const,
  request: { params: reportParam },
  responses: {
    200: jsonResponse("The deleted report's id", deletedReportSchema),
    403: errorResponse(`${FORBIDDEN}, or not allowed to delete it`),
    404: errorResponse("Unknown report, or another user's private report"),
  },
});

type Variables = BaseVariables & { workspaceId: string };

async function viewerOf(
  c: Context<{ Variables: Variables }>,
): Promise<ReportViewer> {
  return {
    userId: c.get("userId"),
    canManage: await hasWorkspacePermission(c, {
      workspace: ["manage_settings"],
    }),
  };
}

const analyticsReport = apiRouter<Variables>()
  .openapi(listRoute, async (c) =>
    c.json(
      await listReports(c.req.valid("query").workspaceId, await viewerOf(c)),
      200,
    ),
  )
  .openapi(getRoute, async (c) =>
    c.json(await getReport(c.req.valid("param").id, await viewerOf(c)), 200),
  )
  .openapi(createReportRoute, async (c) =>
    c.json(await createReport(c.req.valid("json"), await viewerOf(c)), 200),
  )
  .openapi(updateReportRoute, async (c) =>
    c.json(
      await updateReport(
        c.req.valid("param").id,
        c.req.valid("json"),
        await viewerOf(c),
      ),
      200,
    ),
  )
  .openapi(deleteReportRoute, async (c) =>
    c.json(await deleteReport(c.req.valid("param").id, await viewerOf(c)), 200),
  );

export default analyticsReport;
