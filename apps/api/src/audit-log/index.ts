import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  exportAuditLogCsv,
  MAX_EXPORT_ROWS,
} from "./controllers/export-audit-log";
import { listAuditLog } from "./controllers/list-audit-log";
import { auditLogPageSchema } from "./response";
import { auditLogFilterQuery, listAuditLogQuery } from "./schema";
import "./capture-events";
import { requestHiddenProjectIds } from "../project/visibility";

export { auditCapture } from "./capture-http";

// The workspace audit log: who changed members, roles, keys, webhooks,
// integrations, settings and projects. Reading it needs audit_log:read
// (owners and admins by default).

const TAGS = ["Audit log"];
const readAuditLog = requireWorkspacePermission({ audit_log: ["read"] });
const forbidden = errorResponse(
  "No workspace access, missing audit_log:read, or an API key without that scope",
);

const listAuditLogRoute = createRoute({
  method: "get",
  operationId: "listAuditLog",
  path: "/",
  tags: TAGS,
  summary: "List audit log",
  description:
    "One page of the workspace audit log, newest first. Filter by actor, action or action prefix, target type and a date range; page with nextCursor. Entries are kept for AUDIT_LOG_RETENTION_DAYS (default 365; 0 keeps them forever). Needs audit_log:read.",
  middleware: [workspaceAccess.fromQuery(), readAuditLog] as const,
  request: { query: listAuditLogQuery },
  responses: {
    200: jsonResponse("A page of audit log entries", auditLogPageSchema),
    400: errorResponse("Invalid query or cursor"),
    403: forbidden,
  },
});

const exportAuditLogRoute = createRoute({
  method: "get",
  operationId: "exportAuditLog",
  path: "/export",
  tags: TAGS,
  summary: "Export audit log as CSV",
  description: `The filtered audit log as a CSV attachment (UTF-8 with a byte-order mark), newest first, at most ${MAX_EXPORT_ROWS.toLocaleString("en-US")} entries; narrow the date range for older ones. Needs audit_log:read.`,
  middleware: [workspaceAccess.fromQuery(), readAuditLog] as const,
  request: { query: auditLogFilterQuery },
  responses: {
    200: {
      description: "The CSV file",
      content: { "text/csv": { schema: { type: "string" } } },
    },
    400: errorResponse("Invalid query"),
    403: forbidden,
  },
});

const auditLog = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listAuditLogRoute, async (c) =>
    c.json(
      await listAuditLog(c.get("workspaceId"), {
        ...c.req.valid("query"),
        hiddenProjectIds: await requestHiddenProjectIds(c),
      }),
      200,
    ),
  )
  .openapi(exportAuditLogRoute, async (c) => {
    const date = new Date().toISOString().slice(0, 10);
    return new Response(
      exportAuditLogCsv(c.get("workspaceId"), {
        ...c.req.valid("query"),
        hiddenProjectIds: await requestHiddenProjectIds(c),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-log-${date}.csv"`,
          "Cache-Control": "no-store",
        },
      },
    );
  });

export default auditLog;
