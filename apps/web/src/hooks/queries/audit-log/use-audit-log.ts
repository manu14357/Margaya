import { useInfiniteQuery } from "@tanstack/react-query";
import listAuditLog from "@/fetchers/audit-log/list-audit-log";
import type { AuditLogFilters } from "@/types/audit-log";

export const auditLogQueryKeys = {
  all: (workspaceId: string) => ["audit-log", workspaceId] as const,
  list: (workspaceId: string, filters: AuditLogFilters) =>
    ["audit-log", workspaceId, filters] as const,
};

/**
 * The workspace audit log, newest first, a page at a time. It is not
 * pushed over the socket; it refreshes when the page regains focus.
 */
export function useAuditLog(
  workspaceId: string | undefined,
  filters: AuditLogFilters,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: auditLogQueryKeys.list(workspaceId ?? "", filters),
    queryFn: ({ pageParam }) =>
      listAuditLog({
        workspaceId: workspaceId ?? "",
        filters,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(workspaceId) && enabled,
    refetchOnWindowFocus: true,
  });
}

export default useAuditLog;
