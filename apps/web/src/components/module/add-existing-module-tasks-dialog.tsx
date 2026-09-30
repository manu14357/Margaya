import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import TaskPickerDialog from "@/components/planning/task-picker-dialog";
import { useAddModuleTasks } from "@/hooks/mutations/module/use-add-module-tasks";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { taskCandidates } from "@/lib/planning/candidates";
import { toast } from "@/lib/toast";
import type { Module } from "@/types/module";
import type { ProjectWithTasks } from "@/types/project";

type AddExistingModuleTasksDialogProps = {
  module: Pick<Module, "id" | "name" | "projectId">;
  /** Tasks already in the module; they are not offered. */
  moduleTaskIds: ReadonlySet<string> | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Picks project tasks that are not in the module yet and adds them. */
export default function AddExistingModuleTasksDialog({
  module,
  moduleTaskIds,
  open,
  onOpenChange,
}: AddExistingModuleTasksDialogProps) {
  const { t } = useTranslation();
  const { data: board } = useGetTasks(module.projectId);
  const addTasks = useAddModuleTasks();

  const candidates = useMemo(
    () =>
      taskCandidates(
        board as ProjectWithTasks | undefined,
        (task) => !moduleTaskIds?.has(task.id),
      ),
    [board, moduleTaskIds],
  );

  const handleAdd = (taskIds: string[], done: () => void) => {
    addTasks.mutate(
      { moduleId: module.id, projectId: module.projectId, taskIds },
      {
        onSuccess: (change) => {
          toast.success(
            t("modules:toast.tasksAdded", {
              count: change.added.length,
              name: module.name,
            }),
          );
          done();
        },
        onError: (error) =>
          toast.error(error.message || t("modules:bulk.error")),
      },
    );
  };

  return (
    <TaskPickerDialog
      open={open}
      onOpenChange={onOpenChange}
      candidates={candidates}
      emptyText={t("modules:addExisting.empty")}
      noResultsText={t("modules:addExisting.noResults")}
      isPending={addTasks.isPending}
      onSubmit={handleAdd}
    />
  );
}
