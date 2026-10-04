import { client } from "@margaya/libs";
import { auditLogQuery } from "@/lib/audit-log/filters";
import { HttpError } from "@/lib/http-error";
import type { AuditLogFilters } from "@/types/audit-log";

export const AUDIT_LOG_PAGE_SIZE = 50;

/** One page of the workspace audit log, newest first. */
async function listAuditLog({
  workspaceId,
  filters,
  cursor,
}: {
  workspaceId: string;
  filters: AuditLogFilters;
  cursor?: string | null;
}) {
  const response = await client["audit-log"].$get({
    query: {
      ...auditLogQuery(workspaceId, filters),
      cursor: cursor || undefined,
      limit: String(AUDIT_LOG_PAGE_SIZE),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listAuditLog;
