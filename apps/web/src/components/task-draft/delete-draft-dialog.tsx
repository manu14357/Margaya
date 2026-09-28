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
import { useDeleteTaskDraft } from "@/hooks/mutations/task-draft/use-delete-task-draft";
import { toast } from "@/lib/toast";

type DeleteDraftDialogProps = {
  draft: { id: string; workspaceId: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
};

/** Confirms deleting a draft; the row leaves at once and returns on error. */
export default function DeleteDraftDialog({
  draft,
  open,
  onOpenChange,
  onDeleted,
}: DeleteDraftDialogProps) {
  const { t } = useTranslation();
  const deleteDraft = useDeleteTaskDraft();

  const handleDelete = () => {
    if (!draft) return;
    onOpenChange(false);
    onDeleted?.();
    // The promise settles even when the editor that opened this closed.
    deleteDraft
      .mutateAsync({ id: draft.id, workspaceId: draft.workspaceId })
      .then(
        () => toast.success(t("tasks:drafts.toast.deleted")),
        () => toast.error(t("tasks:drafts.toast.deleteError")),
      );
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("tasks:drafts.deleteConfirm.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("tasks:drafts.deleteConfirm.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            {t("tasks:drafts.deleteConfirm.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
