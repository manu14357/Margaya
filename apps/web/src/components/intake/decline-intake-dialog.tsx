import { useEffect, useId, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTriageIntakeItem } from "@/hooks/mutations/intake/use-triage-intake-item";
import { formatIntakeKey } from "@/lib/intake";
import { toast } from "@/lib/toast";
import type { IntakeItem } from "@/types/intake";

const MAX_NOTE = 2000;

type DeclineIntakeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: IntakeItem;
  onDeclined?: (item: IntakeItem) => void;
};

/** "Decline WEB-42?" with an optional reason the requester sees. */
export default function DeclineIntakeDialog({
  open,
  onOpenChange,
  item,
  onDeclined,
}: DeclineIntakeDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const [note, setNote] = useState("");
  const triage = useTriageIntakeItem();

  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  const handleDecline = () => {
    const trimmed = note.trim();
    triage.mutate(
      {
        id: item.id,
        projectId: item.projectId,
        action: "decline",
        note: trimmed || undefined,
      },
      {
        onSuccess: (declined) => {
          onOpenChange(false);
          onDeclined?.(declined);
          toast.success(t("intake:decline.toast"));
        },
        onError: (error) =>
          toast.error(error.message || t("intake:decline.error")),
      },
    );
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("intake:decline.title", { key: formatIntakeKey(item.task.key) })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("intake:decline.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5 px-6 pb-4">
          <Label htmlFor={id} className="text-xs">
            {t("intake:decline.reasonLabel")}
          </Label>
          <Textarea
            id={id}
            value={note}
            maxLength={MAX_NOTE}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("intake:decline.reasonPlaceholder")}
          />
          <p className="text-muted-foreground text-xs">
            {t("intake:decline.reasonHint")}
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogClose
            render={
              <Button variant="outline" size="sm" disabled={triage.isPending} />
            }
          >
            {t("common:actions.cancel")}
          </AlertDialogClose>
          <Button
            variant="destructive"
            size="sm"
            disabled={triage.isPending}
            onClick={handleDecline}
          >
            {t("intake:decline.submit")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
