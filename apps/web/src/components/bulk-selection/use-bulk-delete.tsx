import { useCallback, useState } from "react";
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
import { useBulkOperations } from "@/hooks/mutations/task/use-bulk-operations";
import { toast } from "@/lib/toast";

type Options = {
  selectedTaskIds: ReadonlySet<string>;
  /** Runs after a successful delete, e.g. to clear the selection. */
  onDone: () => void;
};

/**
 * The bulk bar's "Delete tasks" confirmation. Nothing moves to the trash
 * until the user agrees in the dialog.
 */
export function useBulkDelete({ selectedTaskIds, onDone }: Options): {
  requestDelete: () => void;
  dialog: React.ReactNode;
} {
  const { t } = useTranslation();
  const { bulkDelete } = useBulkOperations();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const count = selectedTaskIds.size;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await bulkDelete([...selectedTaskIds]);
      toast.success(t("tasks:bulk.deleteSuccess", { count }));
      setIsOpen(false);
      onDone();
    } catch (_error) {
      toast.error(t("tasks:bulk.deleteError"));
    } finally {
      setIsDeleting(false);
    }
  };

  const dialog = (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isDeleting) setIsOpen(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("tasks:bulk.deleteConfirmTitle", { count })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("tasks:bulk.deleteConfirmDescription", { count })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={isDeleting}
            onClick={() => setIsOpen(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            loading={isDeleting}
            onClick={handleDelete}
          >
            {t("tasks:bulk.deleteConfirmAction")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const requestDelete = useCallback(() => setIsOpen(true), []);

  return { requestDelete, dialog };
}
