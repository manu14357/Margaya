import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useTaskSiblings } from "./use-task-siblings";

type TaskStepperProps = {
  projectId: string;
  taskId: string | undefined;
  onNavigate: (taskId: string) => void;
  /** Load the project's board when it is not cached yet (the task page). */
  fetch?: boolean;
  /** "3 of 12" after the arrows (from 640px). */
  showPosition?: boolean;
  className?: string;
};

/**
 * Previous / next task in board order, with "3 of 12". Renders nothing when
 * the task is not on the board (archived, another project, not cached).
 */
export default function TaskStepper({
  projectId,
  taskId,
  onNavigate,
  fetch = false,
  showPosition = true,
  className,
}: TaskStepperProps) {
  const { t } = useTranslation();
  const { previousId, nextId, position, total } = useTaskSiblings(
    projectId,
    taskId,
    { fetch },
  );

  if (position === 0 || total < 2) return null;

  const steps = [
    {
      id: previousId,
      label: t("tasks:detail.previousTask"),
      icon: ChevronUp,
    },
    { id: nextId, label: t("tasks:detail.nextTask"), icon: ChevronDown },
  ];

  return (
    <TooltipProvider>
      <div className={cn("flex items-center gap-0.5", className)}>
        {steps.map(({ id, label, icon: Icon }) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                aria-label={label}
                disabled={!id}
                onClick={() => id && onNavigate(id)}
              >
                <Icon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
        {showPosition && (
          <span className="hidden whitespace-nowrap px-1 text-muted-foreground text-xs tabular-nums sm:inline">
            {t("tasks:detail.position", { position, total })}
          </span>
        )}
      </div>
    </TooltipProvider>
  );
}
