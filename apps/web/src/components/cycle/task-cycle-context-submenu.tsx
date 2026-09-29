import { IterationCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ContextMenuCheckboxItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useSetTaskCycle } from "@/hooks/mutations/cycle/use-set-task-cycle";
import { useCycleLookup } from "@/hooks/queries/cycle/use-cycle-lookup";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cycleOptionGroups } from "@/lib/cycle/options";
import { isAssignableCycle } from "@/lib/cycle/status";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";
import { CycleStatusIcon } from "./cycle-status";

/**
 * The "Cycle" submenu of the task card and row menu: "No cycle", then the
 * current, upcoming and draft cycles. A completed or archived current cycle
 * is listed checked and disabled, as in the sidebar picker.
 */
export default function TaskCycleContextSubmenu({
  task,
  projectId,
}: TaskPropertySlotProps["contextMenu"]) {
  const { t } = useTranslation();
  const { canUpdateCycles, isCheckingPermissions } = useWorkspacePermission();
  const { cycles, cycle } = useCycleLookup(projectId, task.cycleId);
  const { mutate: setTaskCycle } = useSetTaskCycle();

  // Partial task objects (subtask rows) don't carry their cycle; without it
  // the menu can't show which cycle is current.
  if (isCheckingPermissions || !canUpdateCycles() || task.cycleId === undefined)
    return null;

  const cycleId = task.cycleId ?? null;
  const locked = cycle && !isAssignableCycle(cycle) ? cycle : null;

  const select = (nextCycleId: string | null) => {
    if (nextCycleId === cycleId) return;
    const target = cycles.find((candidate) => candidate.id === nextCycleId);
    setTaskCycle(
      { taskId: task.id, projectId, cycleId: nextCycleId },
      {
        onSuccess: () =>
          toast.success(
            target
              ? t("cycles:toast.taskMoved", { name: target.name })
              : t("cycles:toast.taskRemoved"),
          ),
        onError: (error) =>
          toast.error(error.message || t("cycles:toast.assignError")),
      },
    );
  };

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <span>{t("cycles:picker.label")}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-56">
        <ContextMenuCheckboxItem
          checked={cycleId === null}
          onCheckedChange={() => select(null)}
          closeOnClick
        >
          <IterationCw className="size-3.5 text-muted-foreground" />
          <span>{t("cycles:picker.none")}</span>
        </ContextMenuCheckboxItem>
        {locked && (
          <ContextMenuCheckboxItem checked disabled>
            <CycleStatusIcon cycle={locked} className="size-3.5" />
            <span className="truncate">{locked.name}</span>
          </ContextMenuCheckboxItem>
        )}
        {cycleOptionGroups(cycles).flatMap((group) =>
          group.cycles.map((option) => (
            <ContextMenuCheckboxItem
              key={option.id}
              checked={cycleId === option.id}
              onCheckedChange={() => select(option.id)}
              closeOnClick
            >
              <CycleStatusIcon cycle={option} className="size-3.5" />
              <span className="truncate">{option.name}</span>
            </ContextMenuCheckboxItem>
          )),
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
