import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDate, formatDateShort } from "@/lib/format";
import type { CalendarTask } from "./calendar-task-bar";
import { type ToneInfo, toneOf, toneStyle } from "./status-tone";

type DayOverflowPopoverProps = {
  day: Date;
  /** Every task on this day, not just the ones the lane cap hid. */
  tasks: CalendarTask[];
  hiddenCount: number;
  projectSlug?: string;
  onOpenTask: (taskId: string) => void;
  /** Status tones by slug, from the project columns. */
  tones?: ReadonlyMap<string, ToneInfo>;
};

export default function DayOverflowPopover({
  day,
  tasks,
  hiddenCount,
  projectSlug,
  onOpenTask,
  tones,
}: DayOverflowPopoverProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const dayLabel = formatDate(day, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const handleSelectTask = (taskId: string) => {
    setOpen(false);
    onOpenTask(taskId);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label={t("tasks:calendar.dayTasksAriaLabel", { date: dayLabel })}
        className="w-full truncate rounded-sm px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("tasks:calendar.moreTasks", { count: hiddenCount })}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="space-y-1">
          <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {dayLabel}
          </p>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => handleSelectTask(task.id)}
                style={toneStyle(toneOf(task.status, tones))}
                className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md border-l-[3px] border-l-(color:--tone) px-2 py-1.5 text-left transition-colors hover:bg-(color:--tone-tint) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {projectSlug && task.number != null ? (
                  <span className="truncate text-[10px] text-muted-foreground">
                    {projectSlug}-{task.number}
                  </span>
                ) : null}
                <span className="w-full truncate text-xs font-medium text-foreground">
                  {task.title}
                </span>
                <span className="w-full truncate text-[11px] text-muted-foreground">
                  {formatDateShort(task.scheduleStart)} –{" "}
                  {formatDateShort(task.scheduleEnd)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
