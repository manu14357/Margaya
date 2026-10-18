import type { Context } from "hono";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { boundedRequestBody } from "../utils/bounded-request-body";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { type ExternalPermissions, previewExternalImport } from "./preview";
import { externalImportResultSchema, externalPreviewSchema } from "./response";
import { runExternalImport } from "./run";
import {
  EXTERNAL_IMPORT_BODY_BYTES,
  externalImportBody,
  externalImportParams,
  externalPreviewBody,
} from "./schema";

async function permissionsOf(c: Context): Promise<ExternalPermissions> {
  const [update, comments] = await Promise.all([
    hasWorkspacePermission(c, { task: ["update"] }),
    // Comments carry their original author, like the Jira import's.
    hasWorkspacePermission(c, { workspace: ["manage_settings"] }),
  ]);
  return { update, comments };
}

const previewRoute = createRoute({
  method: "post",
  operationId: "previewExternalImport",
  path: "/{source}/{projectId}/preview",
  tags: ["Tasks"],
  summary: "Preview a Trello, Linear or Asana import",
  description:
    "Reads an export without importing it: the item count, statuses (Trello lists, Linear statuses, Asana sections) with a suggested column, priorities, people matched to workspace members by email (or a unique name), comments, checklists, sub-tasks and links, and how many items were imported into this project before. Trello takes the board's JSON export (at most 10 MiB); Linear and Asana take their CSV export (at most 5 MiB). At most 5,000 items.",
  middleware: [
    boundedRequestBody(EXTERNAL_IMPORT_BODY_BYTES),
    workspaceAccess.fromProject("projectId", {
      notFoundMessage: "Project not found",
    }),
    // The task import's guard; optional parts check their own permission.
    requireWorkspacePermission({ task: ["create"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: externalImportParams,
    body: {
      required: true,
      content: { "application/json": { schema: externalPreviewBody } },
    },
  },
  responses: {
    200: jsonResponse("What the import would read", externalPreviewSchema),
    400: errorResponse(
      "Not an export of the chosen tool, empty, or over 5,000 items",
    ),
    403: errorResponse("No workspace access, or missing task:create"),
    404: errorResponse("Project not found"),
    413: errorResponse("The file is larger than the source's limit"),
  },
});

const importRoute = createRoute({
  method: "post",
  operationId: "importExternalItems",
  path: "/{source}/{projectId}",
  tags: ["Tasks"],
  summary: "Import a Trello, Linear or Asana export",
  description:
    "Creates a task per Trello card, Linear issue or Asana task: title, Markdown description, status through `statusMap`, priority through `priorityMap`, assignees matched to members by email (or a unique name; unmatched people are named in the description and the task stays unassigned), labels (Trello labels, Linear labels, Asana tags), start, due, created and completed dates, Trello comments and checklists (as task lists in the description), and sub-tasks, blocking and related links between items of the file. Archived Trello cards and archived Linear issues are left out. Each task records its source id, so a re-run skips items imported before, or updates them with mode `update`. Items are written one by one: a failing item is reported and the others still import. One import per project runs at a time (409 otherwise).",
  middleware: [
    boundedRequestBody(EXTERNAL_IMPORT_BODY_BYTES),
    workspaceAccess.fromProject("projectId", {
      notFoundMessage: "Project not found",
    }),
    // The task import's guard; optional parts check their own permission.
    requireWorkspacePermission({ task: ["create"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: externalImportParams,
    body: {
      required: true,
      content: { "application/json": { schema: externalImportBody } },
    },
  },
  responses: {
    200: jsonResponse("Import summary", externalImportResultSchema),
    400: errorResponse(
      "Not an export of the chosen tool, empty, or over 5,000 items",
    ),
    403: errorResponse(
      "No workspace access, missing task:create, or mode update without task:update",
    ),
    404: errorResponse("Project not found"),
    409: errorResponse("Another import into this project is running"),
    413: errorResponse("The file is larger than the source's limit"),
  },
});

const externalImport = apiRouter()
  .openapi(previewRoute, async (c) => {
    const { source, projectId } = c.req.valid("param");
    const { content, timeZone } = c.req.valid("json");
    const preview = await previewExternalImport({
      source,
      projectId,
      content,
      timeZone,
      permissions: await permissionsOf(c),
    });
    return c.json(preview, 200);
  })
  .openapi(importRoute, async (c) => {
    const { source, projectId } = c.req.valid("param");
    const { content, timeZone, options } = c.req.valid("json");
    const result = await runExternalImport({
      source,
      projectId,
      content,
      timeZone,
      options,
      userId: c.get("userId"),
      permissions: await permissionsOf(c),
    });
    return c.json(result, 200);
  });

export default externalImport;
