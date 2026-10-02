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
import { useDeleteIntakeItem } from "@/hooks/mutations/intake/use-delete-intake-item";
import { formatIntakeKey } from "@/lib/intake";
import { toast } from "@/lib/toast";
import type { IntakeItem } from "@/types/intake";

type DeleteIntakeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: IntakeItem;
  /** A requester withdrawing their own open request. */
  withdraw: boolean;
  onDeleted?: (item: IntakeItem) => void;
};

/** Deletes the request and its task, or withdraws the caller's request. */
export default function DeleteIntakeDialog({
  open,
  onOpenChange,
  item,
  withdraw,
  onDeleted,
}: DeleteIntakeDialogProps) {
  const { t } = useTranslation();
  const remove = useDeleteIntakeItem();

  const handleDelete = () =>
    remove.mutate(item.id, {
      onSuccess: () => {
        onOpenChange(false);
        onDeleted?.(item);
        toast.success(
          withdraw
            ? t("intake:delete.withdrawToast")
            : t("intake:delete.toast"),
        );
      },
      onError: (error) =>
        toast.error(error.message || t("intake:delete.error")),
    });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {withdraw
              ? t("intake:delete.withdrawTitle")
              : t("intake:delete.title", {
                  key: formatIntakeKey(item.task.key),
                })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {withdraw
              ? t("intake:delete.withdrawDescription")
              : t("intake:delete.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose
            render={
              <Button variant="outline" size="sm" disabled={remove.isPending} />
            }
          >
            {t("common:actions.cancel")}
          </AlertDialogClose>
          <Button
            variant="destructive"
            size="sm"
            disabled={remove.isPending}
            onClick={handleDelete}
          >
            {withdraw
              ? t("intake:delete.withdrawSubmit")
              : t("intake:delete.submit")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
