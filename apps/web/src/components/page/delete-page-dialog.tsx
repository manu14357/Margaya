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
import { useDeletePage } from "@/hooks/mutations/page/use-delete-page";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import type { PageSummary } from "@/types/page";

type DeletePageDialogProps = {
  page: Pick<PageSummary, "id" | "title" | "projectId">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
};

/** Confirms deleting an archived page; its sub-pages move to the top. */
export default function DeletePageDialog({
  page,
  open,
  onOpenChange,
  onDeleted,
}: DeletePageDialogProps) {
  const { t } = useTranslation();
  const deletePage = useDeletePage();

  const handleDelete = () => {
    if (!page.projectId) return;
    deletePage.mutate(
      { pageId: page.id, projectId: page.projectId },
      {
        onSuccess: () => {
          toast.success(t("pages:toasts.deleted"));
          onOpenChange(false);
          onDeleted?.();
        },
        onError: (error) => {
          toast.error(pageErrorMessage(error) ?? t("pages:toasts.deleteError"));
        },
      },
    );
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !deletePage.isPending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("pages:deleteDialog.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("pages:deleteDialog.description", {
              title: page.title.trim() || t("pages:list.untitled"),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={deletePage.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("pages:deleteDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            loading={deletePage.isPending}
            onClick={handleDelete}
          >
            {t("pages:deleteDialog.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
