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
import { type JiraPermissions, previewJiraImport } from "./preview";
import { jiraImportResultSchema, jiraPreviewSchema } from "./response";
import { runJiraImport } from "./run";
import {
  JIRA_IMPORT_BODY_BYTES,
  jiraImportBody,
  jiraPreviewBody,
  jiraProjectParam,
} from "./schema";

async function permissionsOf(c: Context): Promise<JiraPermissions> {
  const [update, comments, cycles, modules] = await Promise.all([
    hasWorkspacePermission(c, { task: ["update"] }),
    // Comments carry their Jira author, like imported comments elsewhere.
    hasWorkspacePermission(c, { workspace: ["manage_settings"] }),
    hasWorkspacePermission(c, { cycle: ["create"] }),
    hasWorkspacePermission(c, { module: ["create"] }),
  ]);
  return { update, comments, cycles, modules };
}

const previewRoute = createRoute({
  method: "post",
  operationId: "previewJiraImport",
  path: "/{projectId}/preview",
  tags: ["Tasks"],
  summary: "Preview a Jira import",
  description:
    "Reads a Jira CSV export (Export → CSV (all fields)) without importing it: the issue count, detected columns, statuses with a suggested column, priorities with a suggested priority, people matched to workspace members by email or name, and how many issues were imported into this project before. At most 5 MiB and 5,000 issues.",
  middleware: [
    boundedRequestBody(JIRA_IMPORT_BODY_BYTES),
    workspaceAccess.fromProject("projectId"),
    // The task import's guard; optional parts check their own permission.
    requireWorkspacePermission({ task: ["create"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: jiraProjectParam,
    body: {
      required: true,
      content: { "application/json": { schema: jiraPreviewBody } },
    },
  },
  responses: {
    200: jsonResponse("What the import would read", jiraPreviewSchema),
    400: errorResponse("Not a Jira CSV export, empty, or over 5,000 issues"),
    403: errorResponse("No workspace access, or missing task:create"),
    404: errorResponse("Project not found"),
    413: errorResponse("The file is larger than 5 MiB"),
  },
});

const importRoute = createRoute({
  method: "post",
  operationId: "importJiraIssues",
  path: "/{projectId}",
  tags: ["Tasks"],
  summary: "Import issues from a Jira CSV export",
  description:
    "Creates a task per Jira issue: summary, description (wiki markup converted to Markdown), status through `statusMap`, priority through `priorityMap`, assignee and reporter matched to members, labels, due/created/updated dates, estimate, sub-tasks, issue links, comments and optionally sprints (cycles) and components (modules). Each task records its issue key, so a re-run skips issues imported before, or updates them with mode `update`. Issues are written one by one: a failing row is reported and the others still import. One import per project runs at a time (409 otherwise).",
  middleware: [
    boundedRequestBody(JIRA_IMPORT_BODY_BYTES),
    workspaceAccess.fromProject("projectId"),
    // The task import's guard; optional parts check their own permission.
    requireWorkspacePermission({ task: ["create"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: jiraProjectParam,
    body: {
      required: true,
      content: { "application/json": { schema: jiraImportBody } },
    },
  },
  responses: {
    200: jsonResponse("Import summary", jiraImportResultSchema),
    400: errorResponse("Not a Jira CSV export, empty, or over 5,000 issues"),
    403: errorResponse(
      "No workspace access, missing task:create, or an option's permission",
    ),
    404: errorResponse("Project not found"),
    409: errorResponse("Another Jira import into this project is running"),
    413: errorResponse("The file is larger than 5 MiB"),
  },
});

const jiraImport = apiRouter()
  .openapi(previewRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { content, timeZone } = c.req.valid("json");
    const preview = await previewJiraImport({
      projectId,
      content,
      timeZone,
      permissions: await permissionsOf(c),
    });
    return c.json(preview, 200);
  })
  .openapi(importRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { content, timeZone, options } = c.req.valid("json");
    const result = await runJiraImport({
      projectId,
      content,
      timeZone,
      options,
      userId: c.get("userId"),
      permissions: await permissionsOf(c),
    });
    return c.json(result, 200);
  });

export default jiraImport;
