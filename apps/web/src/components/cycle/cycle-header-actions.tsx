import { Kanban, ListPlus, PanelRight, Plus, SquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import FavoriteButton from "@/components/favorite/favorite-button";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Cycle } from "@/types/cycle";
import CycleRowActions from "./cycle-row-actions";

type CycleHeaderActionsProps = {
  cycle: Cycle;
  workspaceId: string;
  taskCount: number;
  canAddTasks: boolean;
  /** The cycle is open and the user may change its tasks. */
  canPlan: boolean;
  /** The split-view planner is showing instead of the board. */
  isPlanning: boolean;
  onTogglePlanning: () => void;
  isPanelOpen: boolean;
  onAddTask: () => void;
  onAddExisting: () => void;
  onTogglePanel: () => void;
  onDeleted: () => void;
};

/** The cycle page's header: count, add buttons, panel toggle, star, menu. */
export default function CycleHeaderActions({
  cycle,
  workspaceId,
  taskCount,
  canAddTasks,
  canPlan,
  isPlanning,
  onTogglePlanning,
  isPanelOpen,
  onAddTask,
  onAddExisting,
  onTogglePanel,
  onDeleted,
}: CycleHeaderActionsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="hidden whitespace-nowrap rounded-md bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs md:inline">
              {t("cycles:detail.taskCount", { count: taskCount })}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t("cycles:detail.taskCountTooltip", { count: taskCount })}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {canPlan && (
        <Button
          variant={isPlanning ? "default" : "outline"}
          size="xs"
          className="gap-1"
          aria-label={
            isPlanning ? t("cycles:plan.done") : t("cycles:plan.open")
          }
          onClick={onTogglePlanning}
        >
          {isPlanning ? (
            <Kanban className="size-3" />
          ) : (
            <ListPlus className="size-3" />
          )}
          <span className="hidden xl:inline">
            {isPlanning ? t("cycles:plan.done") : t("cycles:plan.open")}
          </span>
        </Button>
      )}
      {canAddTasks && !isPlanning && (
        <>
          <Button
            variant="outline"
            size="xs"
            className="gap-1"
            aria-label={t("cycles:detail.addTask")}
            onClick={onAddTask}
          >
            <Plus className="size-3" />
            <span className="hidden 2xl:inline">
              {t("cycles:detail.addTask")}
            </span>
          </Button>
          <Button
            variant="outline"
            size="xs"
            className="gap-1"
            aria-label={t("cycles:detail.addExisting")}
            onClick={onAddExisting}
          >
            <SquarePlus className="size-3" />
            <span className="hidden 2xl:inline">
              {t("cycles:detail.addExisting")}
            </span>
          </Button>
        </>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        className={isPlanning ? "hidden" : undefined}
        aria-label={t("cycles:detail.togglePanel")}
        aria-pressed={isPanelOpen}
        title={t("cycles:detail.togglePanel")}
        onClick={onTogglePanel}
      >
        <PanelRight className="size-3.5" />
      </Button>
      <FavoriteButton
        workspaceId={workspaceId}
        entityType="cycle"
        entityId={cycle.id}
        placeholder={{
          name: cycle.name,
          projectId: cycle.projectId,
          feature: "cycles",
        }}
      />
      <CycleRowActions
        cycle={cycle}
        workspaceId={workspaceId}
        onDeleted={onDeleted}
      />
    </div>
  );
}
