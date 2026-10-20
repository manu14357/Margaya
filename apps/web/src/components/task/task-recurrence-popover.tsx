import { format } from "date-fns";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useRemoveTaskRecurrence,
  useSetTaskRecurrence,
} from "@/hooks/mutations/task-recurrence/use-task-recurrence-mutations";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import {
  isRecurrenceFrequency,
  RECURRENCE_FREQUENCIES,
  type RecurrenceFrequency,
  type RecurrenceTrigger,
  recurrenceSummary,
  weekdayNames,
} from "@/lib/recurrence";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type Rule = {
  frequency: string;
  interval: number;
  weekdays: number[];
  monthDay: number | null;
  trigger: string;
  anchorDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
};

type EndMode = "never" | "date" | "count";

type Draft = {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: number[];
  monthDay: number;
  trigger: RecurrenceTrigger;
  end: EndMode;
  endDate: string;
  count: number;
};

const FREQUENCY_KEYS: Record<RecurrenceFrequency, string> = {
  daily: "tasks:recurrence.frequency.daily",
  weekly: "tasks:recurrence.frequency.weekly",
  monthly: "tasks:recurrence.frequency.monthly",
  yearly: "tasks:recurrence.frequency.yearly",
};

const TRIGGER_KEYS: Record<RecurrenceTrigger, string> = {
  completion: "tasks:recurrence.trigger.completion",
  schedule: "tasks:recurrence.trigger.schedule",
};

/** The task's own date, as the API anchors on it (due, else start, else today). */
function taskDate(task: Task): Date {
  const value = task.dueDate ?? task.startDate;
  return value ? new Date(value) : new Date();
}

function initialDraft(task: Task, rule: Rule | null | undefined): Draft {
  const date = taskDate(task);
  if (rule) {
    return {
      frequency: isRecurrenceFrequency(rule.frequency)
        ? rule.frequency
        : "daily",
      interval: rule.interval,
      weekdays: rule.weekdays.length > 0 ? rule.weekdays : [date.getDay()],
      monthDay: rule.monthDay ?? date.getDate(),
      trigger: rule.trigger === "schedule" ? "schedule" : "completion",
      end: rule.endDate ? "date" : rule.maxOccurrences ? "count" : "never",
      endDate: rule.endDate ?? "",
      count: rule.maxOccurrences ?? 5,
    };
  }
  return {
    frequency: "weekly",
    interval: 1,
    weekdays: [date.getDay()],
    monthDay: date.getDate(),
    trigger: "completion",
    end: "never",
    endDate: "",
    count: 5,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const FIELD = "flex flex-col gap-1.5";
const LEGEND = "font-medium text-muted-foreground text-xs";
const NUMBER_INPUT =
  "h-7 w-16 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24";

type TaskRecurrencePopoverProps = {
  task: Task;
  rule: Rule | null | undefined;
  children: React.ReactElement;
};

/**
 * The repeat picker in the task's properties: how often, which days, what
 * creates the next instance and when the series ends. Keyboard-operable:
 * native inputs, a select, radio groups and toggle buttons.
 */
export default function TaskRecurrencePopover({
  task,
  rule,
  children,
}: TaskRecurrencePopoverProps) {
  const { t, i18n } = useTranslation();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(task, rule));
  const { canUpdateTasks } = useWorkspacePermission();
  const save = useSetTaskRecurrence();
  const remove = useRemoveTaskRecurrence();
  const busy = save.isPending || remove.isPending;

  if (!canUpdateTasks()) return children;

  const update = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const days = weekdayNames(i18n.language);
  const longDays = weekdayNames(i18n.language, "long");
  const target = { taskId: task.id, projectId: task.projectId };

  const preview = recurrenceSummary(
    {
      frequency: draft.frequency,
      interval: draft.interval,
      weekdays: draft.weekdays,
      monthDay: draft.monthDay,
      anchorDate: rule?.anchorDate ?? format(taskDate(task), "yyyy-MM-dd"),
      endDate: draft.end === "date" ? draft.endDate || null : null,
      maxOccurrences: draft.end === "count" ? draft.count : null,
    },
    t,
    i18n.language,
  );

  const toggleWeekday = (day: number) => {
    const has = draft.weekdays.includes(day);
    // A weekly repeat keeps at least one day.
    if (has && draft.weekdays.length === 1) return;
    update({
      weekdays: has
        ? draft.weekdays.filter((value) => value !== day)
        : [...draft.weekdays, day].sort((a, b) => a - b),
    });
  };

  const handleSave = async () => {
    try {
      await save.mutateAsync({
        ...target,
        body: {
          frequency: draft.frequency,
          interval: draft.interval,
          ...(draft.frequency === "weekly" ? { weekdays: draft.weekdays } : {}),
          ...(draft.frequency === "monthly" || draft.frequency === "yearly"
            ? { monthDay: draft.monthDay }
            : {}),
          trigger: draft.trigger,
          endDate: draft.end === "date" && draft.endDate ? draft.endDate : null,
          maxOccurrences: draft.end === "count" ? draft.count : null,
        },
      });
      toast.success(t("tasks:recurrence.saved"));
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("tasks:recurrence.saveError"),
      );
    }
  };

  const handleRemove = async () => {
    try {
      await remove.mutateAsync(target);
      toast.success(t("tasks:recurrence.removed"));
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("tasks:recurrence.saveError"),
      );
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Each opening starts from the saved rule.
        if (next) setDraft(initialDraft(task, rule));
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="flex flex-col gap-3 p-3">
          <h3 className="font-medium text-sm">{t("tasks:recurrence.title")}</h3>

          <div className="flex items-end gap-2">
            <div className={cn(FIELD, "flex-1")}>
              <label htmlFor={`${ids}-frequency`} className={LEGEND}>
                {t("tasks:recurrence.frequency.label")}
              </label>
              <Select
                value={draft.frequency}
                onValueChange={(value) => {
                  if (isRecurrenceFrequency(value))
                    update({ frequency: value });
                }}
              >
                <SelectTrigger id={`${ids}-frequency`} size="sm">
                  <SelectValue>
                    {t(FREQUENCY_KEYS[draft.frequency])}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {RECURRENCE_FREQUENCIES.map((frequency) => (
                    <SelectItem key={frequency} value={frequency}>
                      {t(FREQUENCY_KEYS[frequency])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className={FIELD}>
              <label htmlFor={`${ids}-interval`} className={LEGEND}>
                {t("tasks:recurrence.interval")}
              </label>
              <input
                id={`${ids}-interval`}
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={draft.interval}
                onChange={(event) =>
                  update({
                    interval: clamp(Number(event.target.value), 1, 365),
                  })
                }
                className={NUMBER_INPUT}
              />
            </div>
          </div>

          {draft.frequency === "weekly" && (
            <fieldset className={FIELD}>
              <legend className={cn(LEGEND, "mb-1.5")}>
                {t("tasks:recurrence.weekdays")}
              </legend>
              <div className="flex flex-wrap gap-1">
                {days.map((name, day) => {
                  const pressed = draft.weekdays.includes(day);
                  return (
                    <button
                      // biome-ignore lint/suspicious/noArrayIndexKey: weekdays are fixed.
                      key={day}
                      type="button"
                      aria-pressed={pressed}
                      aria-label={longDays[day]}
                      onClick={() => toggleWeekday(day)}
                      className={cn(
                        "h-7 min-w-9 rounded-md border px-1.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                        pressed
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-foreground hover:bg-accent",
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {(draft.frequency === "monthly" || draft.frequency === "yearly") && (
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`${ids}-month-day`} className={LEGEND}>
                {t("tasks:recurrence.monthDay")}
              </label>
              <input
                id={`${ids}-month-day`}
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                value={draft.monthDay}
                onChange={(event) =>
                  update({ monthDay: clamp(Number(event.target.value), 1, 31) })
                }
                className={NUMBER_INPUT}
              />
            </div>
          )}

          <fieldset className={FIELD}>
            <legend className={cn(LEGEND, "mb-1.5")}>
              {t("tasks:recurrence.trigger.label")}
            </legend>
            <RadioGroup
              className="gap-1.5"
              value={draft.trigger}
              onValueChange={(value) =>
                update({
                  trigger: value === "schedule" ? "schedule" : "completion",
                })
              }
            >
              {(["completion", "schedule"] as const).map((trigger) => (
                <label
                  key={trigger}
                  htmlFor={`${ids}-trigger-${trigger}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <Radio id={`${ids}-trigger-${trigger}`} value={trigger} />
                  {t(TRIGGER_KEYS[trigger])}
                </label>
              ))}
            </RadioGroup>
          </fieldset>

          <fieldset className={FIELD}>
            <legend className={cn(LEGEND, "mb-1.5")}>
              {t("tasks:recurrence.ends.label")}
            </legend>
            <RadioGroup
              className="gap-1.5"
              value={draft.end}
              onValueChange={(value) =>
                update({
                  end: value === "date" || value === "count" ? value : "never",
                })
              }
            >
              <label
                htmlFor={`${ids}-end-never`}
                className="flex min-h-7 items-center gap-2 text-xs"
              >
                <Radio id={`${ids}-end-never`} value="never" />
                {t("tasks:recurrence.ends.never")}
              </label>
              <div className="flex min-h-7 items-center gap-2 text-xs">
                <Radio id={`${ids}-end-date`} value="date" />
                <label htmlFor={`${ids}-end-date`}>
                  {t("tasks:recurrence.ends.onDate")}
                </label>
                <input
                  type="date"
                  aria-label={t("tasks:recurrence.ends.endDate")}
                  disabled={draft.end !== "date"}
                  value={draft.endDate}
                  onChange={(event) => update({ endDate: event.target.value })}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
                />
              </div>
              <div className="flex min-h-7 items-center gap-2 text-xs">
                <Radio id={`${ids}-end-count`} value="count" />
                <label htmlFor={`${ids}-end-count`}>
                  {t("tasks:recurrence.ends.after")}
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label={t("tasks:recurrence.ends.count")}
                  min={2}
                  max={1000}
                  disabled={draft.end !== "count"}
                  value={draft.count}
                  onChange={(event) =>
                    update({
                      count: clamp(Number(event.target.value), 2, 1000),
                    })
                  }
                  className={cn(NUMBER_INPUT, "disabled:opacity-50")}
                />
              </div>
            </RadioGroup>
          </fieldset>

          <p className="text-muted-foreground text-xs" aria-live="polite">
            {preview}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t p-2">
          {rule ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void handleRemove()}
              className="text-muted-foreground"
            >
              {t("tasks:recurrence.remove")}
            </Button>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            disabled={busy || (draft.end === "date" && !draft.endDate)}
            onClick={() => void handleSave()}
          >
            {t("tasks:recurrence.save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
