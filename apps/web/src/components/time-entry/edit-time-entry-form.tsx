import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useUpdateTimeEntry from "@/hooks/mutations/time-entry/use-update-time-entry";
import { fromDateTimeInput, toDateTimeInput } from "@/lib/time-entry/duration";
import { toast } from "@/lib/toast";

type EditableEntry = {
  id: string;
  startTime: string;
  endTime: string | null;
  description: string | null;
};

type FormError = "startInvalid" | "endRequired" | "endBeforeStart";

const ERROR_KEYS = {
  startInvalid: "tasks:timeTracking.editStartInvalid",
  endRequired: "tasks:timeTracking.editEndRequired",
  endBeforeStart: "tasks:timeTracking.editEndBeforeStart",
} as const;

/**
 * Changes an entry's range and note, in place in the popover's list. A running
 * entry may stay open; a finished one can't be reopened, since that would be a
 * second way to start a timer. Inputs are to the minute, so a field left as it
 * was sends the stored instant and keeps its seconds.
 */
export default function EditTimeEntryForm({
  taskId,
  entry,
  onDone,
}: {
  taskId: string;
  entry: EditableEntry;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateTimeEntry(taskId);
  const initialStart = toDateTimeInput(entry.startTime);
  const initialEnd = entry.endTime ? toDateTimeInput(entry.endTime) : "";
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [note, setNote] = useState(entry.description ?? "");
  const [error, setError] = useState<FormError | null>(null);
  const startId = useId();
  const endId = useId();
  const noteId = useId();
  const errorId = useId();
  const hintId = useId();
  const running = entry.endTime === null;
  const startInvalid = error === "startInvalid";
  const endInvalid = error !== null && !startInvalid;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startTime =
      start === initialStart ? entry.startTime : fromDateTimeInput(start);
    const endTime = end === initialEnd ? entry.endTime : fromDateTimeInput(end);
    if (!startTime) return setError("startInvalid");
    if (!endTime && !running) return setError("endRequired");
    if (endTime && Date.parse(endTime) < Date.parse(startTime)) {
      return setError("endBeforeStart");
    }
    setError(null);
    update.mutate(
      {
        id: entry.id,
        startTime,
        endTime: endTime ?? undefined,
        description: note.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t("tasks:timeTracking.edited"));
          onDone();
        },
        onError: (failure) =>
          toast.error(failure.message || t("tasks:timeTracking.editError")),
      },
    );
  };

  return (
    <form className="grid gap-2 py-1" onSubmit={submit}>
      <div className="grid gap-1">
        <Label htmlFor={startId} className="text-xs">
          {t("tasks:timeTracking.editStart")}
        </Label>
        <Input
          id={startId}
          type="datetime-local"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          aria-invalid={startInvalid || undefined}
          aria-describedby={startInvalid ? errorId : undefined}
          className="h-8 text-xs"
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={endId} className="text-xs">
          {t("tasks:timeTracking.editEnd")}
        </Label>
        <Input
          id={endId}
          type="datetime-local"
          value={end}
          onChange={(event) => setEnd(event.target.value)}
          aria-invalid={endInvalid || undefined}
          aria-describedby={endInvalid ? errorId : running ? hintId : undefined}
          className="h-8 text-xs"
        />
        {running && (
          <p id={hintId} className="text-muted-foreground text-xs">
            {t("tasks:timeTracking.editEndRunningHint")}
          </p>
        )}
      </div>
      <div className="grid gap-1">
        <Label htmlFor={noteId} className="text-xs">
          {t("tasks:timeTracking.note")}
        </Label>
        <Input
          id={noteId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          autoComplete="off"
          className="h-8 text-xs"
        />
      </div>
      {error && (
        <p id={errorId} className="text-destructive text-xs">
          {t(ERROR_KEYS[error])}
        </p>
      )}
      <div className="flex justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={update.isPending}
          onClick={onDone}
        >
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" size="xs" disabled={update.isPending}>
          {t("tasks:timeTracking.editSave")}
        </Button>
      </div>
    </form>
  );
}
