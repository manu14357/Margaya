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

type TrashConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  action: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Confirms a permanent delete; nothing happens until the user agrees. */
export default function TrashConfirmDialog({
  open,
  title,
  description,
  action,
  pending,
  onCancel,
  onConfirm,
}: TrashConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            loading={pending}
            onClick={onConfirm}
          >
            {action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
