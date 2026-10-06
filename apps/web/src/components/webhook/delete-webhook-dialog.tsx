import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDeleteWebhook } from "@/hooks/mutations/webhook/use-delete-webhook";
import { toast } from "@/lib/toast";

type DeleteWebhookDialogProps = {
  webhookId: string | null;
  workspaceId: string | undefined;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
};

/** "Delete this webhook?": the delivery log goes with it. */
export function DeleteWebhookDialog({
  webhookId,
  workspaceId,
  onOpenChange,
  onDeleted,
}: DeleteWebhookDialogProps) {
  const { t } = useTranslation();
  const deleteWebhook = useDeleteWebhook(workspaceId);

  const handleDelete = () => {
    if (!webhookId) return;
    deleteWebhook.mutate(webhookId, {
      onSuccess: () => {
        toast.success(t("settings:workspaceWebhooks.toast.deleted"));
        onOpenChange(false);
        onDeleted?.();
      },
      onError: (error) =>
        toast.error(
          error.message || t("settings:workspaceWebhooks.toast.error"),
        ),
    });
  };

  return (
    <AlertDialog
      open={Boolean(webhookId)}
      onOpenChange={(open) => {
        if (!open && deleteWebhook.isPending) return;
        onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("settings:workspaceWebhooks.danger.deleteTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("settings:workspaceWebhooks.danger.deleteDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            {t("common:actions.cancel")}
          </AlertDialogClose>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteWebhook.isPending}
          >
            {deleteWebhook.isPending
              ? t("settings:workspaceWebhooks.danger.deleting")
              : t("settings:workspaceWebhooks.danger.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default DeleteWebhookDialog;
