import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useCreateTimeEntry from "@/hooks/mutations/time-entry/use-create-time-entry";
import { parseDurationInput } from "@/lib/time-entry/duration";
import { toast } from "@/lib/toast";

type LogTimeFormProps = {
  taskId: string;
  /** For tests: the moment the logged time ends. */
  now?: () => Date;
};

/**
 * Logs time spent on a task: a duration ending now, with an optional note.
 */
export default function LogTimeForm({
  taskId,
  now = () => new Date(),
}: LogTimeFormProps) {
  const { t } = useTranslation();
  const createTimeEntry = useCreateTimeEntry();
  const [duration, setDuration] = useState("");
  const [note, setNote] = useState("");
  const [invalid, setInvalid] = useState(false);
  const durationId = useId();
  const noteId = useId();
  const errorId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const seconds = parseDurationInput(duration);
    if (seconds === null) {
      setInvalid(true);
      return;
    }
    const end = now();
    const start = new Date(end.getTime() - seconds * 1000);
    createTimeEntry.mutate(
      {
        taskId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        description: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          setDuration("");
          setNote("");
          toast.success(t("tasks:timeTracking.logged"));
        },
        onError: () => toast.error(t("tasks:timeTracking.logError")),
      },
    );
  };

  return (
    <form className="grid gap-2" onSubmit={submit}>
      <div className="grid gap-1">
        <Label htmlFor={durationId} className="text-xs">
          {t("tasks:timeTracking.duration")}
        </Label>
        <Input
          id={durationId}
          value={duration}
          onChange={(event) => {
            setDuration(event.target.value);
            setInvalid(false);
          }}
          placeholder={t("tasks:timeTracking.durationPlaceholder")}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          autoComplete="off"
          className="h-8 text-sm"
        />
        {invalid && (
          <p id={errorId} className="text-destructive text-xs">
            {t("tasks:timeTracking.durationInvalid")}
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
          className="h-8 text-sm"
        />
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={createTimeEntry.isPending || !duration.trim()}
      >
        {t("tasks:timeTracking.submit")}
      </Button>
    </form>
  );
}
