import { produce } from "immer";
import { Archive, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import { useBulkOperations } from "@/hooks/mutations/task/use-bulk-operations";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import { ArchiveTasksModal } from "../../shared/modals/archive-tasks-modal";

type ColumnHeaderProps = {
  column: ProjectWithTasks["columns"][number];
};

export function ColumnHeader({ column }: ColumnHeaderProps) {
  const { t } = useTranslation();
  const { project, setProject } = useProjectStore();
  const { bulkArchive } = useBulkOperations();
  const { canUpdateTasks, canCreateTasks } = useWorkspacePermission();
  const canTask = canUpdateTasks();
  const canCreate = canCreateTasks();

  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  const handleConfirmArchive = () => {
    if (!column.isFinal || !project) return;

    // Archived tasks keep their column and leave the board (D7).
    const taskIds = column.tasks.map((task) => task.id);
    const updatedProject = produce(project, (draft) => {
      const archivedColumn = draft?.columns?.find(
        (col) => col.id === column.id,
      );
      if (!archivedColumn) return;
      archivedColumn.tasks = [];
    });

    setProject(updatedProject);
    setIsArchiveModalOpen(false);
    bulkArchive(taskIds)
      .then(() =>
        toast.success(t("tasks:archive.success", { count: taskIds.length })),
      )
      .catch(() => {
        setProject(project);
        toast.error(t("tasks:archive.error"));
      });
  };

  return (
    <div className="flex h-7 items-center justify-between gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex shrink-0 text-muted-foreground">
          {getColumnIcon(column.id, column.isFinal, column.icon, column.group)}
        </span>
        <h3 className="truncate font-medium text-[13px] text-foreground">
          {column.name}
        </h3>
        <span className="text-muted-foreground text-xs tabular-nums">
          {column.tasks.length}
        </span>
      </div>

      <div className="flex items-center opacity-100 transition-opacity md:opacity-60 md:group-hover:opacity-100 md:focus-within:opacity-100">
        {canTask && column.isFinal && column.tasks.length > 0 && (
          <button
            type="button"
            onClick={() => setIsArchiveModalOpen(true)}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={t("tasks:listView.archiveAllTooltip")}
          >
            <Archive className="size-3.5" />
          </button>
        )}
        {canCreate && (
          <button
            type="button"
            onClick={() => setIsTaskModalOpen(true)}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={t("tasks:kanban.addTask")}
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>

      <CreateTaskModal
        open={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        projectId={project?.id}
        status={column.id}
      />

      <ArchiveTasksModal
        open={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
        onConfirm={handleConfirmArchive}
        taskCount={column.tasks.length}
      />
    </div>
  );
}
