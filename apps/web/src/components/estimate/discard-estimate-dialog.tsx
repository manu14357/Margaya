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

type DiscardEstimateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
};

/** Asks before a new estimate system with edits is closed. */
export default function DiscardEstimateDialog({
  open,
  onOpenChange,
  onDiscard,
}: DiscardEstimateDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("settings:projectEstimates.create.discardTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("settings:projectEstimates.create.discardDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button type="button" variant="outline" size="sm" />}
          >
            {t("settings:projectEstimates.create.keepEditing")}
          </AlertDialogClose>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onDiscard}
          >
            {t("settings:projectEstimates.create.discard")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
