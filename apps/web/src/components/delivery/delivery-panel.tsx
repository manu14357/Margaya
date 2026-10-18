import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { DeliveryScopeType } from "@/types/delivery";
import ForecastCard from "./forecast-card";
import RiskRadar from "./risk-radar";

/**
 * Forecast plus risk radar for a cycle, module or project. Only people who
 * may read analytics see it; nothing is fetched for anyone else.
 */
export default function DeliveryPanel({
  workspaceId,
  projectId,
  scope,
  id,
}: {
  workspaceId: string;
  projectId: string;
  scope: DeliveryScopeType;
  id: string;
}) {
  const { canReadAnalytics, isCheckingPermissions } = useWorkspacePermission();
  if (isCheckingPermissions || !canReadAnalytics()) return null;
  return (
    <div className="space-y-3">
      <ForecastCard projectId={projectId} scope={scope} id={id} />
      <RiskRadar
        workspaceId={workspaceId}
        projectId={projectId}
        scope={scope}
        id={id}
      />
    </div>
  );
}
