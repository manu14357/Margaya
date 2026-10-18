import { Route } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRisks } from "@/hooks/queries/delivery/use-delivery";
import { cn } from "@/lib/cn";
import { formatCycleDate } from "@/lib/cycle/dates";
import type { DeliveryScopeType, RiskRadar as Radar } from "@/types/delivery";
import { RiskRow, useCollapsible, useTaskMap } from "./risk-list";

const VISIBLE_ROWS = 5;

type RiskRadarProps = {
  workspaceId: string;
  projectId: string;
  scope: DeliveryScopeType;
  id: string;
  className?: string;
};

function CriticalPathLine({ radar }: { radar: Radar }) {
  const { t } = useTranslation();
  const path = radar.criticalPath;
  if (!path) return null;
  const count = path.taskIds.length + path.hiddenCount;
  return (
    <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <Route className="size-3.5 shrink-0" aria-hidden />
      <span>
        {t("delivery:risks.criticalPath.chain", { count })}
        {path.finishDate &&
          ` · ${t("delivery:risks.criticalPath.ends", {
            date: formatCycleDate(path.finishDate),
          })}`}
      </span>
    </p>
  );
}

function RadarBody({
  radar,
  workspaceId,
}: {
  radar: Radar;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const tasks = useTaskMap(radar.tasks);
  const rows = useCollapsible(radar.signals, VISIBLE_ROWS);

  return (
    <div className="space-y-2">
      {radar.signals.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("delivery:risks.empty")}
        </p>
      ) : (
        <ul className="divide-y">
          {rows.visible.map((signal, index) => (
            <RiskRow
              // biome-ignore lint/suspicious/noArrayIndexKey: signals have no id; their order is fixed per response
              key={`${signal.kind}-${index}`}
              signal={signal}
              tasks={tasks}
              workspaceId={workspaceId}
              criticalFinish={radar.criticalPath?.finishDate ?? null}
            />
          ))}
        </ul>
      )}
      {rows.hidden > 0 && (
        <Button variant="ghost" size="xs" onClick={rows.toggle}>
          {rows.expanded
            ? t("delivery:risks.showLess")
            : t("delivery:risks.showAll", { total: radar.signals.length })}
        </Button>
      )}
      <CriticalPathLine radar={radar} />
      {radar.history.cycleTime.samples < 10 && (
        <p className="text-muted-foreground text-xs">
          {t("delivery:risks.noCycleTime")}
        </p>
      )}
      {radar.truncated && (
        <p className="text-muted-foreground text-xs">
          {t("delivery:risks.truncated")}
        </p>
      )}
    </div>
  );
}

/** Computed risks of a cycle, module or project, each linked to its tasks. */
export default function RiskRadar({
  workspaceId,
  projectId,
  scope,
  id,
  className,
}: RiskRadarProps) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useRisks({
    projectId,
    scope,
    id,
  });
  const highCount =
    data?.signals.filter((signal) => signal.severity === "high").length ?? 0;

  return (
    <section
      aria-label={t("delivery:risks.title")}
      className={cn("space-y-2 rounded-xl border bg-card p-3", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-muted-foreground text-xs">
          {t("delivery:risks.title")}
        </h3>
        {data && data.signals.length > 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              highCount > 0
                ? "text-destructive-foreground"
                : "text-muted-foreground",
            )}
          >
            {data.signals.length}
          </span>
        )}
      </div>
      {isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : isError || !data ? (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <span>{t("delivery:risks.error")}</span>
          <Button variant="outline" size="xs" onClick={() => refetch()}>
            {t("delivery:forecast.retry")}
          </Button>
        </div>
      ) : (
        <RadarBody radar={data} workspaceId={workspaceId} />
      )}
    </section>
  );
}
