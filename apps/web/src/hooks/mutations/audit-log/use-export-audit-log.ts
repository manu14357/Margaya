import { useMutation } from "@tanstack/react-query";
import { saveAs } from "file-saver";
import exportAuditLog from "@/fetchers/audit-log/export-audit-log";
import type { AuditLogFilters } from "@/types/audit-log";

/** Downloads the filtered audit log as CSV and saves it. */
export function useExportAuditLog() {
  return useMutation({
    mutationFn: async (input: {
      workspaceId: string;
      filters: AuditLogFilters;
    }) => {
      const file = await exportAuditLog(input);
      saveAs(file.blob, file.fileName);
      return file.fileName;
    },
  });
}

export default useExportAuditLog;
