import { useNavigate } from "@tanstack/react-router";
import { ChartColumn } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenuItem } from "@/components/ui/menu";

type OpenInAnalyticsItemProps = {
  workspaceId: string;
  projectId: string;
  /** Opens the project's analytics filtered to this cycle… */
  cycleId?: string;
  /** …or to this module. */
  moduleId?: string;
};

/**
 * "Open in analytics" for a cycle's or module's "⋯" menu. Render it only
 * for people with the analytics capability.
 */
export default function OpenInAnalyticsItem({
  workspaceId,
  projectId,
  cycleId,
  moduleId,
}: OpenInAnalyticsItemProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <DropdownMenuItem
      onClick={() =>
        navigate({
          to: "/dashboard/workspace/$workspaceId/project/$projectId/analytics",
          params: { workspaceId, projectId },
          search: cycleId ? { cycleId } : { moduleId },
        })
      }
    >
      <ChartColumn />
      {t("analytics:openInAnalytics")}
    </DropdownMenuItem>
  );
}
