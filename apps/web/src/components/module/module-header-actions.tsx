import { PanelRight, Plus, SquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import BriefButton from "@/components/ai/brief/brief-button";
import FavoriteButton from "@/components/favorite/favorite-button";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ModuleDetail } from "@/types/module";
import ModuleRowActions from "./module-row-actions";

type ModuleHeaderActionsProps = {
  module: ModuleDetail;
  workspaceId: string;
  taskCount: number;
  canAddTasks: boolean;
  canAddExisting: boolean;
  isPanelOpen: boolean;
  onAddTask: () => void;
  onAddExisting: () => void;
  onTogglePanel: () => void;
  onDeleted: () => void;
};

/** The module page's header: count, add buttons, panel toggle, star, menu. */
export default function ModuleHeaderActions({
  module,
  workspaceId,
  taskCount,
  canAddTasks,
  canAddExisting,
  isPanelOpen,
  onAddTask,
  onAddExisting,
  onTogglePanel,
  onDeleted,
}: ModuleHeaderActionsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="hidden rounded-md bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs sm:inline">
              {t("modules:detail.taskCount", { count: taskCount })}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t("modules:detail.taskCountTooltip")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {canAddTasks && (
        <Button
          variant="outline"
          size="xs"
          className="gap-1"
          onClick={onAddTask}
        >
          <Plus className="size-3" />
          <span className="hidden sm:inline">
            {t("modules:detail.addTask")}
          </span>
        </Button>
      )}
      {canAddExisting && (
        <Button
          variant="outline"
          size="xs"
          className="gap-1"
          onClick={onAddExisting}
        >
          <SquarePlus className="size-3" />
          <span className="hidden sm:inline">
            {t("modules:detail.addExisting")}
          </span>
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("modules:detail.togglePanel")}
        aria-pressed={isPanelOpen}
        title={t("modules:detail.togglePanel")}
        onClick={onTogglePanel}
      >
        <PanelRight className="size-3.5" />
      </Button>
      <BriefButton
        scopeType="module"
        scopeId={module.id}
        projectId={module.projectId}
        workspaceId={workspaceId}
        name={module.name}
      />
      {!module.archivedAt && (
        <FavoriteButton
          workspaceId={workspaceId}
          entityType="module"
          entityId={module.id}
          placeholder={{
            name: module.name,
            projectId: module.projectId,
            feature: "modules",
          }}
        />
      )}
      <ModuleRowActions
        module={module}
        workspaceId={workspaceId}
        onDeleted={onDeleted}
      />
    </div>
  );
}
