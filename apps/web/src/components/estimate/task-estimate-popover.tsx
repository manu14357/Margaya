import { lazy, type ReactElement, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateTaskEstimate } from "@/hooks/mutations/estimate/use-update-task-estimate";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import type { Estimate } from "@/types/estimate";
import EstimateOptionList from "./estimate-option-list";

// The suggestion brings the AI markdown renderer and editor helpers. The
// estimate property is registered at startup, so a static import put them on
// every first page load; this way they load when a picker first opens.
const EstimateSuggestion = lazy(
  () => import("@/components/insight/estimate-suggestion"),
);

type TaskEstimatePopoverProps = {
  task: { id: string; projectId: string; estimatePointId?: string | null };
  /** The project's active system. */
  estimate: Pick<Estimate, "type" | "points">;
  children: ReactElement;
};

/**
 * Picks the task's estimate; selecting saves right away. Without
 * task:update the trigger renders as plain content.
 */
export default function TaskEstimatePopover({
  task,
  estimate,
  children,
}: TaskEstimatePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { mutate: updateTaskEstimate } = useUpdateTaskEstimate();
  const { canUpdateTasks } = useWorkspacePermission();

  if (!canUpdateTasks()) return children;

  const current = task.estimatePointId ?? null;

  const handleSelect = (pointId: string | null) => {
    setOpen(false);
    if (pointId === current) return;
    updateTaskEstimate(
      {
        taskId: task.id,
        projectId: task.projectId,
        estimatePointId: pointId,
      },
      {
        onError: (error) => {
          toast.error(error.message || t("tasks:estimate.updateError"));
        },
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Suspense fallback={null}>
          <EstimateSuggestion
            task={task}
            estimate={estimate}
            open={open}
            currentPointId={current}
            onPick={handleSelect}
          />
        </Suspense>
        <EstimateOptionList
          estimate={estimate}
          selectedId={current}
          onSelect={handleSelect}
          shortcutsEnabled={open}
        />
      </PopoverContent>
    </Popover>
  );
}
