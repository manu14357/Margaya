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
import { useDeleteView } from "@/hooks/mutations/view/use-view-mutations";
import { toast } from "@/lib/toast";
import type { SavedView } from "@/types/view";

type DeleteViewDialogProps = {
  view: Pick<SavedView, "id" | "name" | "workspaceId">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
};

/** Confirms deleting a view; its tasks are not affected. */
export default function DeleteViewDialog({
  view,
  open,
  onOpenChange,
  onDeleted,
}: DeleteViewDialogProps) {
  const { t } = useTranslation();
  const deleteView = useDeleteView();

  const handleDelete = () => {
    deleteView.mutate(
      { viewId: view.id, workspaceId: view.workspaceId },
      {
        onSuccess: () => {
          toast.success(t("views:toast.deleted"));
          onOpenChange(false);
          onDeleted?.();
        },
        onError: (error) =>
          toast.error(error.message || t("views:toast.deleteError")),
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !deleteView.isPending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("views:delete.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("views:delete.description", { name: view.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={deleteView.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("views:dialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            loading={deleteView.isPending}
            onClick={handleDelete}
          >
            {t("views:delete.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
