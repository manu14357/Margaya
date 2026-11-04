import { HTTPException } from "hono/http-exception";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  requireWorkspacePermission,
  workspacePermissionChecker,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { taskExportAccess } from "./access";
import { createTaskExport } from "./controllers/create-task-export";
import { createWorkspaceExport } from "./controllers/create-workspace-export";
import {
  deleteTaskExport,
  downloadTaskExport,
} from "./controllers/file-task-export";
import { listTaskExports } from "./controllers/list-task-exports";
import type { TaskExportRow } from "./job";
import {
  taskExportDeletedSchema,
  taskExportPageSchema,
  taskExportSchema,
} from "./response";
import {
  createTaskExportBody,
  createWorkspaceExportBody,
  listTaskExportsQuery,
  taskExportParam,
} from "./schema";
import { toTaskExportResponse } from "./serialize";
import "./subscribers";
import { WORKSPACE_EXPORT_PERMISSIONS } from "./types";

// Asynchronous task exports. Anyone with task:read exports and manages
// their own exports; workspace:manage_settings holders also see, download
// and delete everyone's. Someone else's export answers 404, never 403.
// Whole-workspace exports share the queue, history and file routes, but only
// holders of WORKSPACE_EXPORT_PERMISSIONS start them or reach them (access.ts).

const TAGS = ["Exports"];
const readTasks = requireWorkspacePermission({ task: ["read"] });
const notFound = errorResponse(
  "No export with this id, or it belongs to someone else",
);
export const ALL_EXPORTS_FORBIDDEN =
  "Only workspace admins can see all exports";

const createTaskExportRoute = createRoute({
  method: "post",
  operationId: "createTaskExport",
  path: "/",
  tags: TAGS,
  summary: "Start export",
  description:
    "Queue a background export of tasks as CSV, Excel (xlsx) or JSON. Explicit projectIds (archived projects allowed), or every non-archived project when absent. Intake requests still in triage are never exported; archived tasks are unless includeArchived is false. Fields of a turned-off project feature are left empty. At most 3 exports in progress per person and workspace, and 50,000 tasks per export. The requester's user socket receives EXPORT_UPDATED messages as the status changes. Needs task:read.",
  middleware: [
    workspaceAccess.fromBody(),
    readTasks,
    requireEntitlement,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTaskExportBody } },
    },
  },
  responses: {
    200: jsonResponse("The queued export", taskExportSchema),
    400: errorResponse("Invalid body, or no projects to export"),
    403: errorResponse("No workspace access or missing task:read permission"),
    404: errorResponse("A project is not in this workspace"),
    409: errorResponse("The caller already has 3 exports in progress"),
  },
});

const createWorkspaceExportRoute = createRoute({
  method: "post",
  operationId: "createWorkspaceExport",
  path: "/workspace",
  tags: TAGS,
  summary: "Start whole-workspace export",
  description:
    "Queue a background export of the whole workspace as one ZIP: tasks with all their comments, pages, settings and stored files, in the documented margaya.workspace-export.v1 format. Secrets, private pages, trash, drafts and intake requests still in triage are never included. Only one can be in progress per workspace, at most 4 GB, and the file is kept for the export retention period. Download it from the export's download route. Needs workspace:manage_settings and to read all the archive holds (project, task, label, cycle and module read; page read and delete), also to see or download it later.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission(WORKSPACE_EXPORT_PERMISSIONS),
    requireEntitlement,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createWorkspaceExportBody } },
    },
  },
  responses: {
    200: jsonResponse("The queued export", taskExportSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("No workspace access or missing permission"),
    404: errorResponse("The caller is a guest"),
    409: errorResponse(
      "A whole-workspace export is already in progress, or the caller already has 3 exports in progress",
    ),
  },
});

const listTaskExportsRoute = createRoute({
  method: "get",
  operationId: "listTaskExports",
  path: "/",
  tags: TAGS,
  summary: "List exports",
  description:
    "One page of a workspace's exports, newest first: the caller's own (scope mine), or everyone's (scope all, workspace:manage_settings). Keyset paging through nextCursor. Whole-workspace exports appear only for those who may start one. Needs task:read.",
  middleware: [workspaceAccess.fromQuery(), readTasks] as const,
  request: { query: listTaskExportsQuery },
  responses: {
    200: jsonResponse("A page of exports", taskExportPageSchema),
    400: errorResponse("Invalid query or cursor"),
    403: errorResponse(
      "No workspace access, missing task:read, or scope all without workspace:manage_settings",
    ),
  },
});

const getTaskExportRoute = createRoute({
  method: "get",
  operationId: "getTaskExport",
  path: "/{id}",
  tags: TAGS,
  summary: "Get export",
  description:
    "One export and its status. Needs task:read; a whole-workspace export answers 404 to anyone who may not start one.",
  middleware: [taskExportAccess(), readTasks] as const,
  request: { params: taskExportParam },
  responses: {
    200: jsonResponse("The export", taskExportSchema),
    403: errorResponse("No workspace access or missing task:read permission"),
    404: notFound,
  },
});

const downloadTaskExportRoute = createRoute({
  method: "get",
  operationId: "downloadTaskExport",
  path: "/{id}/download",
  tags: TAGS,
  summary: "Download export",
  description:
    "The finished file as an attachment (text/csv, application/json, xlsx or application/zip for split CSV and JSON exports). Available until expiresAt. Needs task:read; a whole-workspace export answers 404 to anyone who may not start one.",
  middleware: [taskExportAccess(), readTasks] as const,
  request: { params: taskExportParam },
  responses: {
    200: {
      description: "The export file",
      content: { "*/*": { schema: { type: "string", format: "binary" } } },
    },
    403: errorResponse("No workspace access or missing task:read permission"),
    404: notFound,
    409: errorResponse("The export isn't ready yet"),
    410: errorResponse("The export has expired"),
  },
});

const deleteTaskExportRoute = createRoute({
  method: "delete",
  operationId: "deleteTaskExport",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete export",
  description:
    "Delete an export and its file for everyone. A queued export is simply removed. Needs task:read; a whole-workspace export answers 404 to anyone who may not start one.",
  middleware: [taskExportAccess(), readTasks] as const,
  request: { params: taskExportParam },
  responses: {
    200: jsonResponse("The export was deleted", taskExportDeletedSchema),
    403: errorResponse("No workspace access or missing task:read permission"),
    404: notFound,
    409: errorResponse("The export is still running"),
  },
});

const taskExport = apiRouter<
  BaseVariables & { workspaceId: string; taskExport: TaskExportRow }
>()
  .openapi(createTaskExportRoute, async (c) => {
    const body = c.req.valid("json");
    const row = await createTaskExport({
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
      format: body.format,
      projectIds: body.projectIds,
      splitByProject: body.splitByProject,
      includeArchived: body.includeArchived,
    });
    return c.json(await toTaskExportResponse(row), 200);
  })
  .openapi(createWorkspaceExportRoute, async (c) => {
    const row = await createWorkspaceExport({
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
      includeFiles: c.req.valid("json").includeFiles,
    });
    return c.json(await toTaskExportResponse(row), 200);
  })
  .openapi(listTaskExportsRoute, async (c) => {
    const { scope, cursor, limit } = c.req.valid("query");
    const can = await workspacePermissionChecker(c);
    if (scope === "all" && !can({ workspace: ["manage_settings"] })) {
      throw new HTTPException(403, { message: ALL_EXPORTS_FORBIDDEN });
    }
    return c.json(
      await listTaskExports({
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        scope,
        canSeeWorkspaceExports: can(WORKSPACE_EXPORT_PERMISSIONS),
        cursor,
        limit,
      }),
      200,
    );
  })
  .openapi(getTaskExportRoute, async (c) =>
    c.json(await toTaskExportResponse(c.get("taskExport")), 200),
  )
  .openapi(downloadTaskExportRoute, async (c) =>
    downloadTaskExport(c.get("taskExport")),
  )
  .openapi(deleteTaskExportRoute, async (c) =>
    c.json(await deleteTaskExport(c.get("taskExport")), 200),
  );

export default taskExport;
