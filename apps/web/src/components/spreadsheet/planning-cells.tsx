import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import TaskCyclePopover from "@/components/cycle/task-cycle-popover";
import TaskEstimatePopover from "@/components/estimate/task-estimate-popover";
import ModuleMultiSelect from "@/components/module/module-multi-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSetTaskModules } from "@/hooks/mutations/module/use-set-task-modules";
import { useCycleLookup } from "@/hooks/queries/cycle/use-cycle-lookup";
import { useActiveEstimate } from "@/hooks/queries/estimate/use-active-estimate";
import useGetModules from "@/hooks/queries/module/use-get-modules";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { formatEstimateValue } from "@/lib/estimate/format";
import { toast } from "@/lib/toast";
import type { TaskQueryMeta, TaskQueryRow } from "@/types/task-query";
import { LazyEditor } from "./spreadsheet-cell";

// Cycle, modules and estimate cells reuse the pickers of their slices; each
// shows the row's value and mounts its picker when used.

type PlanningCellProps = {
  row: TaskQueryRow;
  meta: TaskQueryMeta;
  canEdit: boolean;
};

function Muted({ children }: { children: string }) {
  return <span className="truncate text-muted-foreground">{children}</span>;
}

function CycleEditor({
  row,
  trigger,
}: {
  row: TaskQueryRow;
  trigger: ReactElement;
}) {
  const { cycles, cycle } = useCycleLookup(row.projectId, row.cycleId);
  return (
    <TaskCyclePopover
      task={{ id: row.id, projectId: row.projectId, cycleId: row.cycleId }}
      cycles={cycles}
      currentCycle={cycle}
    >
      {trigger}
    </TaskCyclePopover>
  );
}

export function SpreadsheetCycleEditor({
  row,
  meta,
  canEdit,
}: PlanningCellProps) {
  const { t } = useTranslation();
  const cycle = row.cycleId
    ? meta.cycles.find((candidate) => candidate.id === row.cycleId)
    : undefined;
  return (
    <LazyEditor
      display={
        cycle ? (
          <span className="truncate">{cycle.name}</span>
        ) : (
          <Muted>{t("tasks:filters.values.noCycle")}</Muted>
        )
      }
      editable={canEdit}
      renderEditor={(trigger) => <CycleEditor row={row} trigger={trigger} />}
    />
  );
}

function EstimateEditor({
  row,
  workspaceId,
  trigger,
}: {
  row: TaskQueryRow;
  workspaceId: string;
  trigger: ReactElement;
}) {
  const { estimate } = useActiveEstimate({
    projectId: row.projectId,
    workspaceId,
  });
  if (!estimate) return trigger;
  return (
    <TaskEstimatePopover
      task={{
        id: row.id,
        projectId: row.projectId,
        estimatePointId: row.estimatePointId,
      }}
      estimate={estimate}
    >
      {trigger}
    </TaskEstimatePopover>
  );
}

export function SpreadsheetEstimateEditor({
  row,
  meta,
  canEdit,
  workspaceId,
  format,
}: PlanningCellProps & {
  workspaceId: string;
  format: typeof formatEstimateValue;
}) {
  const { t } = useTranslation();
  const point = row.estimatePointId
    ? meta.estimatePoints.find(
        (candidate) => candidate.id === row.estimatePointId,
      )
    : undefined;
  return (
    <LazyEditor
      display={
        point ? (
          <span className="truncate">{format(point.type, point.value)}</span>
        ) : (
          <Muted>{t("tasks:filters.values.noEstimate")}</Muted>
        )
      }
      editable={canEdit}
      renderEditor={(trigger) => (
        <EstimateEditor row={row} workspaceId={workspaceId} trigger={trigger} />
      )}
    />
  );
}

function ModulesEditor({
  row,
  trigger,
}: {
  row: TaskQueryRow;
  trigger: ReactElement;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => row.moduleIds ?? [],
  );
  const { data: modules = [] } = useGetModules(row.projectId);
  const { mutate: setTaskModules } = useSetTaskModules();
  const { canUpdateModules } = useWorkspacePermission();

  if (!canUpdateModules()) return trigger;

  const toggle = (moduleId: string) => {
    const isIn = selectedIds.includes(moduleId);
    setSelectedIds((current) =>
      isIn ? current.filter((id) => id !== moduleId) : [...current, moduleId],
    );
    setTaskModules(
      {
        taskId: row.id,
        projectId: row.projectId,
        ...(isIn
          ? { removeModuleIds: [moduleId] }
          : { addModuleIds: [moduleId] }),
      },
      {
        onError: () => {
          setSelectedIds(row.moduleIds ?? []);
          toast.error(t("modules:toast.membershipError"));
        },
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <ModuleMultiSelect
          modules={modules}
          selectedIds={selectedIds}
          onToggle={toggle}
        />
      </PopoverContent>
    </Popover>
  );
}

export function SpreadsheetModulesEditor({
  row,
  meta,
  canEdit,
}: PlanningCellProps) {
  const { t } = useTranslation();
  const modules = (row.moduleIds ?? []).flatMap((id) => {
    const module = meta.modules.find((candidate) => candidate.id === id);
    return module ? [module] : [];
  });
  return (
    <LazyEditor
      display={
        modules.length === 0 ? (
          <Muted>{t("tasks:filters.values.noModule")}</Muted>
        ) : (
          <span className="flex min-w-0 items-center gap-1">
            {modules.slice(0, 2).map((module) => (
              <span
                key={module.id}
                className="truncate rounded border border-border px-1.5 py-0.5 text-[11px]"
              >
                {module.name}
              </span>
            ))}
            {modules.length > 2 && (
              <span className="text-muted-foreground text-xs">
                +{modules.length - 2}
              </span>
            )}
          </span>
        )
      }
      editable={canEdit}
      renderEditor={(trigger) => <ModulesEditor row={row} trigger={trigger} />}
    />
  );
}
