import { useTranslation } from "react-i18next";
import {
  MAX_PINNED_REPORTS,
  normalizeHomeWidgets,
  pinnedReportIds,
  togglePinnedReport,
} from "@/components/home/home-widgets";
import useGetHomePreferences from "@/hooks/queries/home/use-get-home-preferences";
import { toast } from "@/lib/toast";
import useUpdateHomePreferences from "./use-update-home-preferences";

/**
 * Pins saved reports to the caller's Home. Saving sends the whole widget list,
 * so nothing can be pinned until the current list has loaded: saving the
 * defaults instead would lose the person's order.
 */
function useToggleHomeReportPin(workspaceId: string) {
  const { t } = useTranslation();
  const { data } = useGetHomePreferences({ workspaceId });
  const update = useUpdateHomePreferences();
  const widgets = data ? normalizeHomeWidgets(data.widgets) : null;
  const pinnedIds = widgets ? pinnedReportIds(widgets) : [];

  const toggle = (reportId: string, liveIds: readonly string[]) => {
    if (!widgets) return;
    const next = togglePinnedReport(widgets, reportId, liveIds);
    if (!next) {
      toast.error(
        t("analytics:reports.toast.pinLimit", { count: MAX_PINNED_REPORTS }),
      );
      return;
    }
    const pinning = !pinnedIds.includes(reportId);
    update.mutate(
      { workspaceId, widgets: next },
      {
        onSuccess: () =>
          toast.success(
            pinning
              ? t("analytics:reports.toast.pinned")
              : t("analytics:reports.toast.unpinned"),
          ),
        onError: () => toast.error(t("analytics:reports.toast.pinError")),
      },
    );
  };

  return { pinnedIds, isReady: Boolean(widgets), toggle };
}

export default useToggleHomeReportPin;
