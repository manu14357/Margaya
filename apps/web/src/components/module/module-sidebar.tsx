import { useTranslation } from "react-i18next";
import GroupProgressBar from "@/components/charts/group-progress-bar";
import {
  EstimateChartUnitToggle,
  estimateChartOf,
  useStoredChartUnit,
} from "@/components/estimate/estimate-chart";
import EstimateProgressSummary from "@/components/estimate/estimate-progress-summary";
import ExpandableDescription from "@/components/planning/expandable-description";
import PlanningBreakdown, {
  type PlanningFilterControls,
} from "@/components/planning/planning-breakdown";
import { useStoredState } from "@/components/planning/use-stored-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import useGetModuleProgress from "@/hooks/queries/module/use-get-module-progress";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { BurnChartMode } from "@/lib/charts/burn-chart-model";
import { canEditModule } from "@/lib/module/status";
import type { ModuleDetail } from "@/types/module";
import { ModuleStatusChip } from "./module-bits";
import ModuleChart from "./module-chart";
import ModuleLinksSection from "./module-links-section";
import ModuleSidebarProperties from "./module-sidebar-properties";

type ModuleSidebarProps = PlanningFilterControls & {
  module: ModuleDetail;
  workspaceId: string;
};

function isChartMode(value: unknown) {
  return value === "burndown" || value === "burnup";
}

/** The module's details, progress, chart, breakdowns and links. */
export default function ModuleSidebar({
  module,
  workspaceId,
  ...filters
}: ModuleSidebarProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useStoredState<BurnChartMode>(
    "margaya:module-chart-mode",
    "burndown",
    isChartMode,
  );
  const [unit, setUnit] = useStoredChartUnit();
  const { canUpdateModules, isCheckingPermissions } = useWorkspacePermission();
  const { data: progress, isLoading } = useGetModuleProgress(
    module.projectId,
    module.id,
  );
  const canEdit =
    !isCheckingPermissions && canUpdateModules() && canEditModule(module);
  const estimateChart = estimateChartOf(progress);

  return (
    <div className="space-y-4 p-3 md:p-4">
      <section className="space-y-2">
        <ModuleStatusChip module={module} />
        <h2 className="font-semibold text-base leading-snug">{module.name}</h2>
        <ExpandableDescription text={module.description} />
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="font-medium text-muted-foreground text-xs">
            {t("modules:sidebar.progress")}
          </h3>
          <span className="font-semibold text-lg tabular-nums">
            {t("modules:sidebar.percentComplete", {
              percent: module.progress,
            })}
          </span>
        </div>
        <GroupProgressBar
          counts={module.counts}
          cancelledLabel={t("modules:sidebar.cancelledCount", {
            count: module.counts.cancelled,
          })}
        />
        <EstimateProgressSummary estimates={progress?.estimates} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            size="sm"
            variant="outline"
            value={[mode]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "burndown" || next === "burnup") setMode(next);
            }}
          >
            <Toggle value="burndown" className="px-2 text-xs">
              {t("modules:chart.burndown")}
            </Toggle>
            <Toggle value="burnup" className="px-2 text-xs">
              {t("modules:chart.burnup")}
            </Toggle>
          </ToggleGroup>
          {estimateChart && (
            <EstimateChartUnitToggle
              value={unit}
              onChange={setUnit}
              type={estimateChart.type}
            />
          )}
        </div>
        <ModuleChart
          module={module}
          progress={progress}
          isLoading={isLoading}
          mode={mode}
          unit={estimateChart ? unit : "tasks"}
        />
      </section>

      <ModuleSidebarProperties
        module={module}
        workspaceId={workspaceId}
        canEdit={canEdit}
      />

      <section>
        {progress ? (
          <PlanningBreakdown progress={progress} {...filters} />
        ) : isLoading ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : null}
      </section>

      <ModuleLinksSection module={module} canEdit={canEdit} />
    </div>
  );
}
