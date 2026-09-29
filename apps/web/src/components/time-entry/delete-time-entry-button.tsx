import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import useDeleteTimeEntry from "@/hooks/mutations/time-entry/use-delete-time-entry";
import { toast } from "@/lib/toast";

type DeleteTimeEntryButtonProps = {
  taskId: string;
  entryId: string;
  /** The entry's date as shown in its row; names the button for screen readers. */
  dateLabel: string;
};

/**
 * Deletes one time entry after an inline confirmation. Inline rather than a
 * dialog because it lives inside the time-tracking popover.
 */
export default function DeleteTimeEntryButton({
  taskId,
  entryId,
  dateLabel,
}: DeleteTimeEntryButtonProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteTimeEntry(taskId);

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("tasks:timeTracking.deleteEntry", { date: dateLabel })}
        title={t("tasks:timeTracking.deleteEntry", { date: dateLabel })}
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    );
  }

  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">
        {t("tasks:timeTracking.deleteEntry", { date: dateLabel })}
      </legend>
      <span className="text-muted-foreground">
        {t("tasks:timeTracking.deleteConfirm")}
      </span>
      <Button
        variant="destructive"
        size="xs"
        autoFocus
        disabled={remove.isPending}
        onClick={() =>
          remove.mutate(entryId, {
            onSuccess: () => toast.success(t("tasks:timeTracking.deleted")),
            onError: (error) => {
              setConfirming(false);
              toast.error(error.message || t("tasks:timeTracking.deleteError"));
            },
          })
        }
      >
        {t("common:actions.delete")}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        disabled={remove.isPending}
        onClick={() => setConfirming(false)}
      >
        {t("common:actions.cancel")}
      </Button>
    </fieldset>
  );
}
