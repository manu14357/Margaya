import { CopyPlus, Ellipsis, Hash, Link as LinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTopBarOverflowHost } from "@/components/common/header/top-bar-overflow";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { copyTaskKey, copyTaskLink } from "@/lib/copy-task-reference";
import { formatTaskKey, shareableTaskUrl } from "@/lib/task-key";
import useCopyTaskDialog from "@/store/copy-task-dialog";

type TaskActionsMenuProps = {
  taskId: string;
  /** The project the task is shown in; the task's own project wins once loaded. */
  projectId: string;
  workspaceId: string;
};

/** The "⋯" menu of the task sheet and page: copy link or key, make a copy. */
export default function TaskActionsMenu({
  taskId,
  projectId,
  workspaceId,
}: TaskActionsMenuProps) {
  const { t } = useTranslation();
  const { data: task } = useGetTask(taskId);
  const ownProjectId = task?.projectId ?? projectId;
  const { data: project } = useGetProject({
    id: ownProjectId,
    workspaceId,
  });
  const { canCreateTasks } = useWorkspacePermission();
  const openCopyDialog = useCopyTaskDialog((state) => state.open);
  const slug = project?.id === ownProjectId ? project.slug : undefined;
  // In a crowded top bar this menu also holds what the bar's own "More"
  // would, so the page shows one "…" rather than two side by side.
  const overflow = useTopBarOverflowHost();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-foreground"
            aria-label={t("tasks:actions.moreActions")}
            title={t("tasks:actions.moreActions")}
          />
        }
      >
        <Ellipsis className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {overflow && overflow.length > 0 && (
          <>
            {overflow.map((item) => (
              <DropdownMenuItem
                key={item.id}
                className="gap-2"
                onClick={item.onSelect}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          className="gap-2"
          onClick={() =>
            void copyTaskLink(
              shareableTaskUrl({
                workspaceId,
                projectId: ownProjectId,
                taskId,
                slug,
                number: task?.number,
              }),
              t,
            )
          }
        >
          <LinkIcon className="size-4" />
          {t("tasks:actions.copyLink")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2"
          disabled={!slug || task?.number == null}
          onClick={() => {
            if (slug && task)
              void copyTaskKey(formatTaskKey(slug, task.number), t);
          }}
        >
          <Hash className="size-4" />
          {t("tasks:actions.copyKey")}
        </DropdownMenuItem>
        {canCreateTasks() && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2"
              disabled={!task}
              onClick={() =>
                openCopyDialog({
                  taskId,
                  projectId: ownProjectId,
                  workspaceId,
                })
              }
            >
              <CopyPlus className="size-4" />
              {t("tasks:actions.makeCopy")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
