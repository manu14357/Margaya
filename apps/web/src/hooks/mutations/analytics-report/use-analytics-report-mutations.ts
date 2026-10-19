import { useMutation, useQueryClient } from "@tanstack/react-query";
import createAnalyticsReport from "@/fetchers/analytics-report/create-analytics-report";
import deleteAnalyticsReport from "@/fetchers/analytics-report/delete-analytics-report";
import updateAnalyticsReport from "@/fetchers/analytics-report/update-analytics-report";
import { analyticsReportQueryKeys } from "@/hooks/queries/analytics-report/analytics-report-query-keys";
import type {
  AnalyticsReport,
  CreateAnalyticsReportInput,
  UpdateAnalyticsReportInput,
} from "@/types/analytics-report";

// Reports never change tasks, so they skip the task query refresh.
const meta = { refreshTaskQueries: false };

/**
 * Puts the saved report in the cached list at once (so it can show as the
 * opened report), then refetches the list.
 */
function useSettleReport() {
  const queryClient = useQueryClient();
  return (saved: AnalyticsReport) => {
    const key = analyticsReportQueryKeys.list(saved.workspaceId);
    queryClient.setQueryData<AnalyticsReport[]>(key, (current) =>
      current
        ? current.some((report) => report.id === saved.id)
          ? current.map((report) => (report.id === saved.id ? saved : report))
          : [...current, saved]
        : current,
    );
    void queryClient.invalidateQueries({ queryKey: key });
  };
}

export function useCreateAnalyticsReport() {
  const settle = useSettleReport();
  return useMutation({
    meta,
    mutationFn: (input: CreateAnalyticsReportInput) =>
      createAnalyticsReport(input),
    onSuccess: settle,
  });
}

export function useUpdateAnalyticsReport() {
  const settle = useSettleReport();
  return useMutation({
    meta,
    mutationFn: ({
      id,
      changes,
    }: {
      id: string;
      changes: UpdateAnalyticsReportInput;
    }) => updateAnalyticsReport(id, changes),
    onSuccess: settle,
  });
}

export function useDeleteAnalyticsReport() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: ({ id }: { id: string; workspaceId: string }) =>
      deleteAnalyticsReport(id),
    onSuccess: (_deleted, { id, workspaceId }) => {
      const key = analyticsReportQueryKeys.list(workspaceId);
      queryClient.setQueryData<AnalyticsReport[]>(key, (current) =>
        current?.filter((report) => report.id !== id),
      );
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
