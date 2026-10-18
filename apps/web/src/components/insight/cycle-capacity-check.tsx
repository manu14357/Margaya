import { AlertTriangle, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CycleCapacity } from "@/fetchers/insight/insight";
import { useCycleCapacity } from "@/hooks/queries/insight/use-insight";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { getPriorityIcon } from "@/lib/priority";

type CycleCapacityCheckProps = {
  cycleId: string;
  projectId: string;
};

/**
 * Capacity check (#10) in the cycle planner: the planned work against what
 * the team finished in comparable time before, with tasks to defer when it
 * is over. Computed, no AI; shown to people who may read analytics.
 */
export default function CycleCapacityCheck({
  cycleId,
  projectId,
}: CycleCapacityCheckProps) {
  const { canReadAnalytics, isCheckingPermissions } = useWorkspacePermission();
  if (isCheckingPermissions || !canReadAnalytics()) return null;
  return <CapacityBody cycleId={cycleId} projectId={projectId} />;
}

function CapacityBody({ cycleId, projectId }: CycleCapacityCheckProps) {
  const { data } = useCycleCapacity(projectId, cycleId);
  if (!data) return null;
  return <CapacitySummary capacity={data} />;
}

export function CapacitySummary({ capacity }: { capacity: CycleCapacity }) {
  const { t } = useTranslation();
  const unit = (count: number) =>
    capacity.unit === "points"
      ? t("insight:capacity.points", { count })
      : t("insight:capacity.tasks", { count });

  if (capacity.plannedDays === null) {
    return (
      <p className="text-muted-foreground text-xs">
        {t("insight:capacity.noDates")}
      </p>
    );
  }
  // No percent means the team finished nothing comparable yet (a usual
  // cycle of 0), which says nothing about this cycle's load.
  if (
    !capacity.capacity ||
    capacity.load === null ||
    capacity.percent === null
  ) {
    return (
      <p className="text-muted-foreground text-xs">
        {t("insight:capacity.noHistory")}
      </p>
    );
  }
  const over = capacity.status === "over";
  const percent = capacity.percent ?? 0;
  return (
    <div className="space-y-1.5" data-testid="cycle-capacity">
      <div className="flex items-center gap-1.5 text-xs">
        {over ? (
          <AlertTriangle
            aria-hidden="true"
            className="size-3.5 shrink-0 text-warning-foreground"
          />
        ) : (
          <Gauge
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
        <span
          role={over ? "status" : undefined}
          className={cn(
            "tabular-nums",
            over
              ? "font-medium text-warning-foreground"
              : "text-muted-foreground",
          )}
        >
          {over
            ? t("insight:capacity.over", { percent })
            : t("insight:capacity.within", { percent })}
        </span>
      </div>
      <div
        className="relative h-1.5 overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <div
          className={cn(
            "h-full rounded-full",
            over ? "bg-warning-foreground/60" : "bg-foreground/30",
          )}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer select-none">
          {t("insight:capacity.details")}
        </summary>
        <div className="mt-1.5 space-y-2">
          <p className="tabular-nums">
            {t("insight:capacity.compare", {
              load: unit(capacity.load),
              typical: unit(capacity.capacity.typical),
              low: capacity.capacity.low,
              high: capacity.capacity.high,
            })}
          </p>
          <p>
            {capacity.basis === "cycles"
              ? t("insight:capacity.basisCycles", {
                  count: capacity.historyCycles,
                })
              : t("insight:capacity.basisThroughput")}
          </p>
          {capacity.deferrals.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                {t("insight:capacity.deferTitle")}
              </p>
              <ul className="space-y-0.5">
                {capacity.deferrals.map((task) => (
                  <li key={task.id} className="flex items-center gap-1.5">
                    <span className="flex size-3.5 shrink-0 items-center justify-center">
                      {getPriorityIcon(task.priority)}
                    </span>
                    <span className="shrink-0 font-mono">{task.key}</span>
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={task.title}
                    >
                      {task.title}
                    </span>
                    {task.dependants > 0 && (
                      <span className="shrink-0">
                        {t("insight:capacity.blocks", {
                          count: task.dependants,
                        })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {capacity.members && capacity.members.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                {t("insight:capacity.membersTitle")}
              </p>
              <ul className="space-y-0.5">
                {capacity.members.map((member) => (
                  <li
                    key={member.userId ?? "unassigned"}
                    className="flex items-center gap-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {member.name ?? t("insight:capacity.unassigned")}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        member.status === "over" && "text-warning-foreground",
                      )}
                    >
                      {member.typical === null
                        ? unit(
                            capacity.unit === "points"
                              ? (member.points ?? 0)
                              : member.tasks,
                          )
                        : t("insight:capacity.memberLoad", {
                            load: unit(
                              capacity.unit === "points"
                                ? (member.points ?? 0)
                                : member.tasks,
                            ),
                            typical: member.typical,
                          })}
                    </span>
                  </li>
                ))}
              </ul>
              <p>{t("insight:capacity.membersNote")}</p>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
