import { format } from "date-fns";
import { Diamond } from "lucide-react";
import { type FormEvent, type JSX, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import { toTaskDateValue } from "@/lib/schedule-dates";
import { toast } from "@/lib/toast";
import { parseTaskDate } from "./timeline";

type GanttAddMilestoneProps = {
  projectId: string;
  /** The column new work lands in. */
  status: string;
  /** Lets the chart bring the new milestone into view. */
  onCreated: (day: Date) => void;
};

/**
 * A milestone straight from the timeline: a name and a date. It is an
 * ordinary task underneath, in the project's entry column.
 */
export default function GanttAddMilestone({
  projectId,
  status,
  onCreated,
}: GanttAddMilestoneProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const createTask = useCreateTask();
  const parsedDay = parseTaskDate(day);
  const canSubmit = title.trim().length > 0 && parsedDay !== null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !parsedDay || createTask.isPending) return;
    const date = toTaskDateValue(parsedDay);
    try {
      await createTask.mutateAsync({
        projectId,
        title: title.trim(),
        description: "",
        status,
        priority: "no-priority",
        assigneeIds: [],
        startDate: date,
        dueDate: date,
        isMilestone: true,
      });
      setOpen(false);
      setTitle("");
      onCreated(parsedDay);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("tasks:gantt.milestone.createError"),
      );
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="touch-manipulation"
            data-testid="gantt-add-milestone"
          />
        }
      >
        <Diamond className="size-3.5" />
        {t("tasks:gantt.milestone.add")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <form className="flex flex-col gap-2 p-2" onSubmit={handleSubmit}>
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("tasks:gantt.milestone.namePlaceholder")}
            aria-label={t("tasks:gantt.milestone.name")}
            className="h-8 [&_[data-slot=input]]:text-xs"
          />
          <input
            type="date"
            required
            aria-label={t("tasks:gantt.milestone.date")}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
          <Button
            type="submit"
            size="xs"
            disabled={!canSubmit}
            loading={createTask.isPending}
          >
            {t("tasks:gantt.milestone.create")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
