import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useArchivedTaskBulk } from "@/hooks/mutations/archive/use-archived-task-bulk";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";

type DeleteArchivedTasksDialogProps = {
  /** The tasks to delete; null closes the dialog. */
  taskIds: string[] | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (ids: string[]) => void;
};

/** "Delete 3 tasks?": deletes archived tasks for good. */
export default function DeleteArchivedTasksDialog({
  taskIds,
  onOpenChange,
  onDeleted,
}: DeleteArchivedTasksDialogProps) {
  const { t } = useTranslation();
  const { remove } = useArchivedTaskBulk();
  const clearSelection = useBulkSelectionStore((state) => state.clearSelection);
  const count = taskIds?.length ?? 0;

  const handleDelete = () => {
    if (!taskIds?.length) return;
    const ids = taskIds;
    remove.mutate(ids, {
      onSuccess: () => {
        onDeleted(ids);
        clearSelection();
        onOpenChange(false);
        toast.success(
          t("workspace:archives.toast.tasksDeleted", { count: ids.length }),
        );
      },
      onError: () =>
        toast.error(t("workspace:archives.toast.tasksDeleteError")),
    });
  };

  return (
    <AlertDialog
      open={taskIds !== null}
      onOpenChange={(open) => !remove.isPending && onOpenChange(open)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("workspace:archives.bulk.deleteTitle", { count })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("workspace:archives.bulk.deleteDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={remove.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            loading={remove.isPending}
            onClick={handleDelete}
          >
            {t("workspace:archives.bulk.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
