import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useTaskWhiteboards } from "@/hooks/queries/whiteboard/use-task-whiteboards";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import WhiteboardIcon from "./whiteboard-icon";

type TaskWhiteboardsProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
};

/**
 * "On whiteboards" on the task detail: the visible boards that hold a card
 * for the task. Rendered only with the project's Whiteboards feature on,
 * whiteboard read access and at least one board.
 */
export function TaskWhiteboards({
  taskId,
  projectId,
  workspaceId,
}: TaskWhiteboardsProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(true);
  const { isEnabled } = useProjectFeatures({ projectId, workspaceId });
  const { canReadWhiteboards } = useWorkspacePermission();
  const enabled = isEnabled("whiteboards") && canReadWhiteboards();
  const { data } = useTaskWhiteboards(taskId, enabled);
  const boards = data?.whiteboards ?? [];

  if (!enabled || boards.length === 0) return null;

  const untitled = t("whiteboards:list.untitled");

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <div className="flex items-center gap-1.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
          >
            {isOpen ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <span>{t("whiteboards:taskBoards.title")}</span>
          </button>
        </CollapsibleTrigger>
        <span className="text-muted-foreground text-xs">{boards.length}</span>
      </div>

      <CollapsibleContent>
        <ul className="mt-1 flex flex-col">
          {boards.map((board) => (
            <li key={board.id}>
              <Link
                to="/dashboard/workspace/$workspaceId/project/$projectId/whiteboards/$whiteboardId"
                params={{
                  workspaceId,
                  projectId: board.projectId,
                  whiteboardId: board.id,
                }}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <WhiteboardIcon icon={board.icon} />
                <span className="truncate">
                  {board.title.trim() || untitled}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default TaskWhiteboards;
