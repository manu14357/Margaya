import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSetTaskCycle } from "@/hooks/mutations/cycle/use-set-task-cycle";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { isAssignableCycle } from "@/lib/cycle/status";
import { toast } from "@/lib/toast";
import type { Cycle } from "@/types/cycle";
import CycleOptionList from "./cycle-option-list";

type TaskCyclePopoverProps = {
  task: { id: string; projectId: string; cycleId?: string | null };
  /** The project's live cycles. */
  cycles: readonly Cycle[];
  /** The task's cycle, when known (it may be archived). */
  currentCycle: Cycle | null;
  children: ReactElement;
};

/** Picks the task's cycle. Without cycle:update it only shows the trigger. */
export default function TaskCyclePopover({
  task,
  cycles,
  currentCycle,
  children,
}: TaskCyclePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { mutate: setTaskCycle } = useSetTaskCycle();
  const { canUpdateCycles } = useWorkspacePermission();

  if (!canUpdateCycles()) return children;

  const cycleId = task.cycleId ?? null;
  const lockedCycle =
    currentCycle && !isAssignableCycle(currentCycle) ? currentCycle : null;

  const handleSelect = (nextCycleId: string | null) => {
    setOpen(false);
    if (nextCycleId === cycleId) return;
    const target = cycles.find((cycle) => cycle.id === nextCycleId);
    setTaskCycle(
      { taskId: task.id, projectId: task.projectId, cycleId: nextCycleId },
      {
        onSuccess: () => {
          toast.success(
            target
              ? t("cycles:toast.taskMoved", { name: target.name })
              : t("cycles:toast.taskRemoved"),
          );
        },
        onError: (error) => {
          toast.error(error.message || t("cycles:toast.assignError"));
        },
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <CycleOptionList
          cycles={cycles}
          selectedId={cycleId}
          lockedCycle={lockedCycle}
          onSelect={handleSelect}
          shortcutsEnabled={open}
        />
      </PopoverContent>
    </Popover>
  );
}
