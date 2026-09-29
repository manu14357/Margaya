import { Clock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useGetTimeEntriesByTaskId from "@/hooks/queries/time-entry/use-get-time-entries";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { splitDuration, totalLoggedSeconds } from "@/lib/time-entry/duration";
import DeleteTimeEntryButton from "./delete-time-entry-button";
import LogTimeForm from "./log-time-form";

type Translate = ReturnType<typeof useTranslation>["t"];

export function formatLoggedTime(seconds: number, t: Translate) {
  const { hours, minutes } = splitDuration(seconds);
  if (hours && minutes) {
    return t("tasks:timeTracking.hoursMinutes", { hours, minutes });
  }
  if (hours) return t("tasks:timeTracking.hours", { hours });
  return t("tasks:timeTracking.minutes", { minutes });
}

/**
 * The "Time spent" row of the task properties sidebar: the total logged on
 * the task, and a popover to log more and see each entry. Registered only
 * for projects with time tracking on.
 */
export default function TaskTimeTracking({
  task,
  layout,
}: TaskPropertySlotProps["sidebar"]) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { canUpdateTasks, canDeleteTasks } = useWorkspacePermission();
  const canLog = canUpdateTasks();
  // The API lets the author delete their own entry, and anyone who may
  // delete tasks delete others' (both also need task:update).
  const canDelete = (entryUserId: string | null) =>
    canLog && ((!!user && entryUserId === user.id) || canDeleteTasks());
  const { data: entries = [], isLoading } = useGetTimeEntriesByTaskId(task.id);
  const total = totalLoggedSeconds(entries);
  const totalText = formatLoggedTime(total, t);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            total > 0
              ? t("tasks:timeTracking.spentAria", { total: totalText })
              : t("tasks:timeTracking.logTime")
          }
          title={t("tasks:timeTracking.label")}
          className={cn(
            "h-7 justify-start gap-1.5 px-1.5",
            layout === "stack" && "w-full",
          )}
        >
          <Clock className="size-3.5 text-muted-foreground" />
          <span
            className={cn(
              "truncate font-semibold text-xs",
              total === 0 && "text-muted-foreground",
            )}
          >
            {total > 0 ? totalText : t("tasks:timeTracking.logTime")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="grid gap-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{t("tasks:timeTracking.label")}</span>
            <span className="text-muted-foreground">{totalText}</span>
          </div>
          {canLog && <LogTimeForm taskId={task.id} />}
          {isLoading ? null : entries.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t("tasks:timeTracking.empty")}
            </p>
          ) : (
            <ul
              aria-label={t("tasks:timeTracking.entries")}
              className="grid max-h-56 gap-1.5 overflow-y-auto border-border border-t pt-2"
            >
              {entries.map((entry) => (
                <li key={entry.id} className="grid gap-0.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {entry.userName ?? t("tasks:timeTracking.formerMember")}
                    </span>
                    <span className="shrink-0 font-medium">
                      {entry.duration === null
                        ? t("tasks:timeTracking.running")
                        : formatLoggedTime(entry.duration, t)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-muted-foreground">
                      {formatDateShort(entry.startTime, i18n.resolvedLanguage)}
                      {entry.description ? ` · ${entry.description}` : ""}
                    </span>
                    {canDelete(entry.userId) && (
                      <DeleteTimeEntryButton
                        taskId={task.id}
                        entryId={entry.id}
                        dateLabel={formatDateShort(
                          entry.startTime,
                          i18n.resolvedLanguage,
                        )}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
