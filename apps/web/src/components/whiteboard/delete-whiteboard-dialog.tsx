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

type DeleteWhiteboardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  pending: boolean;
  onConfirm: () => void;
};

/** Confirms moving an archived board to the project's trash. */
export default function DeleteWhiteboardDialog({
  open,
  onOpenChange,
  title,
  pending,
  onConfirm,
}: DeleteWhiteboardDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("whiteboards:dialogs.delete.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("whiteboards:dialogs.delete.description", { title })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("whiteboards:dialogs.cancel")}
          </Button>
          <Button variant="destructive" loading={pending} onClick={onConfirm}>
            {t("whiteboards:dialogs.delete.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
