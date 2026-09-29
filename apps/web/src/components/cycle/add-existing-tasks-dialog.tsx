import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import TaskPickerDialog from "@/components/planning/task-picker-dialog";
import { useAddCycleTasks } from "@/hooks/mutations/cycle/use-add-cycle-tasks";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { taskCandidates } from "@/lib/planning/candidates";
import { toast } from "@/lib/toast";
import type { Cycle } from "@/types/cycle";
import type { ProjectWithTasks } from "@/types/project";

type AddExistingTasksDialogProps = {
  cycle: Pick<Cycle, "id" | "name" | "projectId">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Picks project tasks that are in no cycle and adds them to this one. */
export default function AddExistingTasksDialog({
  cycle,
  open,
  onOpenChange,
}: AddExistingTasksDialogProps) {
  const { t } = useTranslation();
  const { data: board } = useGetTasks(cycle.projectId);
  const addTasks = useAddCycleTasks();

  const candidates = useMemo(
    () =>
      taskCandidates(
        board as ProjectWithTasks | undefined,
        (task) => !task.cycleId,
      ),
    [board],
  );

  const handleAdd = (taskIds: string[], done: () => void) => {
    addTasks.mutate(
      { cycleId: cycle.id, projectId: cycle.projectId, taskIds },
      {
        onSuccess: (change) => {
          toast.success(
            t("cycles:toast.tasksAdded", {
              count: change.added.length + change.moved.length,
              name: cycle.name,
            }),
          );
          done();
        },
        onError: (error) =>
          toast.error(error.message || t("cycles:bulk.error")),
      },
    );
  };

  return (
    <TaskPickerDialog
      open={open}
      onOpenChange={onOpenChange}
      candidates={candidates}
      emptyText={t("cycles:addExisting.allPlanned")}
      noResultsText={t("cycles:addExisting.noResults")}
      isPending={addTasks.isPending}
      onSubmit={handleAdd}
    />
  );
}
