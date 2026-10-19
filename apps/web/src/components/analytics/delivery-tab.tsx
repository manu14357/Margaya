import { useTranslation } from "react-i18next";
import BriefButton from "@/components/ai/brief/brief-button";
import ForecastCard from "@/components/delivery/forecast-card";
import RiskRadar from "@/components/delivery/risk-radar";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useAnalyticsScope } from "./analytics-context";

/** Project analytics → Delivery: the open work's forecast and risk radar. */
export default function DeliveryTab() {
  const { t } = useTranslation();
  const { workspaceId, projectId } = useAnalyticsScope();
  const { data: project } = useGetProject({
    id: projectId ?? "",
    workspaceId,
  });
  if (!projectId) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-muted-foreground text-sm">
          {t("delivery:tab.description")}
        </p>
        <BriefButton
          scopeType="project"
          scopeId={projectId}
          projectId={projectId}
          workspaceId={workspaceId}
          name={project?.name ?? ""}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <ForecastCard projectId={projectId} scope="project" id={projectId} />
        <RiskRadar
          workspaceId={workspaceId}
          projectId={projectId}
          scope="project"
          id={projectId}
        />
      </div>
    </div>
  );
}
