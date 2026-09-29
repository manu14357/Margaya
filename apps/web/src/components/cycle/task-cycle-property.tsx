import { IterationCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useCycleLookup } from "@/hooks/queries/cycle/use-cycle-lookup";
import { cn } from "@/lib/cn";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import TaskCyclePopover from "./task-cycle-popover";

/** The "Cycle" row of the task properties sidebar. */
export default function TaskCycleProperty({
  task,
  layout,
  projectId,
}: TaskPropertySlotProps["sidebar"]) {
  const { t } = useTranslation();
  const { cycles, cycle } = useCycleLookup(projectId, task.cycleId);

  return (
    <TaskCyclePopover
      task={{ ...task, projectId }}
      cycles={cycles}
      currentCycle={cycle}
    >
      <Button
        variant="ghost"
        size="sm"
        title={t("cycles:picker.label")}
        className={cn(
          "h-7 justify-start gap-1.5 px-1.5",
          layout === "stack" && "w-full",
        )}
      >
        <IterationCw className="size-3.5 text-muted-foreground" />
        <span
          className={cn(
            "max-w-40 truncate font-semibold text-xs",
            !cycle && "text-muted-foreground",
          )}
        >
          {cycle?.name ?? t("cycles:picker.none")}
        </span>
      </Button>
    </TaskCyclePopover>
  );
}
