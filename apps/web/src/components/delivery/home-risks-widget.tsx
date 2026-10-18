import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import WidgetSection, {
  WidgetEmpty,
  WidgetError,
} from "@/components/home/widget-section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHomeRisks } from "@/hooks/queries/delivery/use-delivery";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { RiskRow, useCollapsible, useTaskMap } from "./risk-list";

const VISIBLE_ROWS = 4;

type HomeRisksWidgetProps = {
  workspaceId: string;
  onOpenTask?: (taskId: string, projectId: string) => void;
};

/**
 * Home: the top computed risks of the current cycles you can see. Shown
 * only to people who may read analytics; nothing is fetched otherwise.
 */
export default function HomeRisksWidget({ workspaceId }: HomeRisksWidgetProps) {
  const { canReadAnalytics, isCheckingPermissions } = useWorkspacePermission();
  const allowed = !isCheckingPermissions && canReadAnalytics();
  if (!allowed) return null;
  return <HomeRisksBody workspaceId={workspaceId} />;
}

function HomeRisksBody({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useHomeRisks(workspaceId);
  const tasks = useTaskMap(data?.tasks);
  const rows = useCollapsible(data?.signals ?? [], VISIBLE_ROWS);

  return (
    <WidgetSection
      title={t("delivery:home.title")}
      icon={ShieldAlert}
      tone="var(--area-analytics)"
    >
      {isPending ? (
        <Skeleton className="h-20 rounded-lg" />
      ) : isError || !data ? (
        <WidgetError
          message={t("delivery:risks.error")}
          retryLabel={t("delivery:forecast.retry")}
          onRetry={() => refetch()}
        />
      ) : data.signals.length === 0 ? (
        <WidgetEmpty>{t("delivery:home.empty")}</WidgetEmpty>
      ) : (
        <div className="space-y-1">
          <ul className="divide-y">
            {rows.visible.map((signal, index) => (
              <RiskRow
                // biome-ignore lint/suspicious/noArrayIndexKey: signals have no id; their order is fixed per response
                key={`${signal.cycleId}-${signal.kind}-${index}`}
                signal={signal}
                tasks={tasks}
                workspaceId={workspaceId}
                context={t("delivery:home.context", {
                  project: signal.projectName,
                  cycle: signal.cycleName,
                })}
              />
            ))}
          </ul>
          {rows.hidden > 0 && (
            <Button variant="ghost" size="xs" onClick={rows.toggle}>
              {rows.expanded
                ? t("delivery:risks.showLess")
                : t("delivery:risks.showAll", { total: data.signals.length })}
            </Button>
          )}
        </div>
      )}
    </WidgetSection>
  );
}
