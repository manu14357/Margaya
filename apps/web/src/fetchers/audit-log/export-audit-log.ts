import { client } from "@margaya/libs";
import { auditLogQuery } from "@/lib/audit-log/filters";
import { HttpError } from "@/lib/http-error";
import { fileNameFromDisposition } from "@/lib/task-export/file-name";
import type { AuditLogFilters } from "@/types/audit-log";

/** The filtered audit log as a CSV file, through the authorized route. */
async function exportAuditLog({
  workspaceId,
  filters,
}: {
  workspaceId: string;
  filters: AuditLogFilters;
}) {
  const response = await client["audit-log"].export.$get({
    query: auditLogQuery(workspaceId, filters),
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const blob = await response.blob();
  const fileName = fileNameFromDisposition(
    response.headers.get("Content-Disposition"),
    "audit-log.csv",
  );
  return { blob, fileName };
}

export default exportAuditLog;
