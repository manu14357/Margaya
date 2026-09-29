import { useQueryClient } from "@tanstack/react-query";
import { IterationCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAddCycleTasks } from "@/hooks/mutations/cycle/use-add-cycle-tasks";
import { useRemoveCycleTasks } from "@/hooks/mutations/cycle/use-remove-cycle-tasks";
import useGetCycles from "@/hooks/queries/cycle/use-get-cycles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { changedTaskIds, groupTaskIdsByCycle } from "@/lib/cycle/batch";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";
import type { ProjectWithTasks } from "@/types/project";
import CycleOptionList from "./cycle-option-list";

function cycleIdsOnBoard(board: ProjectWithTasks | undefined) {
  const cycleOf = new Map<string, string | null>();
  if (!board) return cycleOf;
  const tasks = [
    ...board.columns.flatMap((column) => column.tasks),
    ...(board.plannedTasks ?? []),
    ...(board.archivedTasks ?? []),
  ];
  for (const task of tasks) cycleOf.set(task.id, task.cycleId ?? null);
  return cycleOf;
}

/** "Cycle…" in the bulk-selection toolbars: move or remove every task. */
export default function CycleBulkAction({
  taskIds,
  onDone,
  projectId,
}: TaskPropertySlotProps["bulkAction"]) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { canUpdateCycles } = useWorkspacePermission();
  const { data: cycles = [] } = useGetCycles(projectId);
  const addTasks = useAddCycleTasks();
  const removeTasks = useRemoveCycleTasks();

  if (!canUpdateCycles()) return null;

  const isPending = addTasks.isPending || removeTasks.isPending;

  const handleSelect = async (cycleId: string | null) => {
    setOpen(false);
    try {
      if (cycleId) {
        const target = cycles.find((cycle) => cycle.id === cycleId);
        const change = await addTasks.mutateAsync({
          cycleId,
          projectId,
          taskIds,
        });
        toast.success(
          t("cycles:bulk.moved", {
            count: changedTaskIds(change).length + change.unchanged.length,
            name: target?.name ?? "",
          }),
        );
      } else {
        const board = queryClient.getQueryData<ProjectWithTasks>([
          "tasks",
          projectId,
        ]);
        const cycleOf = cycleIdsOnBoard(board);
        const groups = groupTaskIdsByCycle(taskIds, (id) => cycleOf.get(id));
        const change = await removeTasks.mutateAsync({
          projectId,
          taskIdsByCycle: groups,
        });
        toast.success(
          t("cycles:bulk.removed", { count: change.removed.length }),
        );
      }
      onDone();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("cycles:bulk.error"),
      );
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" disabled={isPending}>
          <IterationCw className="size-4" />
          {t("cycles:bulk.action")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="center">
        <CycleOptionList
          cycles={cycles}
          selectedId={undefined}
          onSelect={(cycleId) => void handleSelect(cycleId)}
        />
      </PopoverContent>
    </Popover>
  );
}
