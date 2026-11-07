import { Clock, Pencil } from "lucide-react";
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
import { totalLoggedSeconds } from "@/lib/time-entry/duration";
import { formatLoggedTime } from "@/lib/time-entry/format";
import DeleteTimeEntryButton from "./delete-time-entry-button";
import EditTimeEntryForm from "./edit-time-entry-form";
import ElapsedTime from "./elapsed-time";
import LogTimeForm from "./log-time-form";
import TaskTimer from "./task-timer";

/**
 * The "Time spent" row of the task properties sidebar: the total logged on
 * the task, and a popover to start or stop a timer, log more and see each
 * entry. Registered only for projects with time tracking on.
 */
export default function TaskTimeTracking({
  task,
  layout,
  workspaceId,
}: TaskPropertySlotProps["sidebar"]) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { user } = useAuth();
  const { canUpdateTasks, canDeleteTasks } = useWorkspacePermission();
  const canLog = canUpdateTasks();
  // The API lets the author change or delete their own entry, and anyone who
  // may delete tasks change or delete others' (both also need task:update).
  const canChange = (entryUserId: string | null) =>
    canLog && ((!!user && entryUserId === user.id) || canDeleteTasks());
  const {
    data: entries = [],
    isLoading,
    isError,
  } = useGetTimeEntriesByTaskId(task.id);
  const total = totalLoggedSeconds(entries);
  const totalText = formatLoggedTime(total, t);
  const myRunning = entries.find(
    (entry) => entry.endTime === null && !!user && entry.userId === user.id,
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEditingId(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            myRunning
              ? t("tasks:timeTracking.timerRunning")
              : total > 0
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
          {myRunning ? (
            <ElapsedTime
              startTime={myRunning.startTime}
              className="truncate font-semibold text-xs tabular-nums"
            />
          ) : (
            <span
              className={cn(
                "truncate font-semibold text-xs",
                total === 0 && "text-muted-foreground",
              )}
            >
              {total > 0 ? totalText : t("tasks:timeTracking.logTime")}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="grid gap-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{t("tasks:timeTracking.label")}</span>
            <span className="text-muted-foreground">{totalText}</span>
          </div>
          {/* While an entry is being edited its form is the popover's one task. */}
          {canLog && !editingId && (
            <TaskTimer taskId={task.id} workspaceId={workspaceId} />
          )}
          {canLog && !editingId && <LogTimeForm taskId={task.id} />}
          {isLoading ? null : isError ? (
            <p role="alert" className="text-destructive text-xs">
              {t("tasks:timeTracking.loadError")}
            </p>
          ) : entries.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t("tasks:timeTracking.empty")}
            </p>
          ) : (
            <ul
              aria-label={t("tasks:timeTracking.entries")}
              // minmax(0,1fr): a long note truncates instead of widening the
              // rows past the popover and pushing durations and buttons out.
              className={cn(
                "grid grid-cols-[minmax(0,1fr)] gap-1.5 overflow-y-auto border-border border-t pt-2",
                editingId ? "max-h-80" : "max-h-56",
              )}
            >
              {entries.map((entry) => {
                if (editingId === entry.id) {
                  return (
                    <li key={entry.id} className="text-xs">
                      <EditTimeEntryForm
                        taskId={task.id}
                        entry={entry}
                        onDone={() => setEditingId(null)}
                      />
                    </li>
                  );
                }
                const dateLabel = formatDateShort(
                  entry.startTime,
                  i18n.resolvedLanguage,
                );
                return (
                  <li
                    key={entry.id}
                    className="grid grid-cols-[minmax(0,1fr)] gap-0.5 text-xs"
                  >
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
                      <span
                        className="min-w-0 truncate text-muted-foreground"
                        title={entry.description ?? undefined}
                      >
                        {dateLabel}
                        {entry.description ? ` · ${entry.description}` : ""}
                      </span>
                      {canChange(entry.userId) && (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("tasks:timeTracking.editEntry", {
                              date: dateLabel,
                            })}
                            title={t("tasks:timeTracking.editEntry", {
                              date: dateLabel,
                            })}
                            onClick={() => setEditingId(entry.id)}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          <DeleteTimeEntryButton
                            taskId={task.id}
                            entryId={entry.id}
                            dateLabel={dateLabel}
                          />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
