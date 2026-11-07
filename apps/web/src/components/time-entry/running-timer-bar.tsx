import { Link } from "@tanstack/react-router";
import { Square, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import useStopTimeEntry from "@/hooks/mutations/time-entry/use-stop-time-entry";
import { cn } from "@/lib/cn";
import { formatTaskKey } from "@/lib/task-key";
import { formatLoggedTime } from "@/lib/time-entry/format";
import { toast } from "@/lib/toast";
import ElapsedTime from "./elapsed-time";

export type RunningTimer = {
  id: string;
  taskId: string;
  startTime: string;
  taskTitle: string;
  taskNumber: number | null;
  projectId: string;
  projectSlug: string;
};

/** The caller's running timer with its stop button; names it unless `here`. */
export default function RunningTimerBar({
  timer,
  workspaceId,
  here = false,
  className,
}: {
  timer: RunningTimer;
  workspaceId: string;
  /** The timer belongs to the task on screen, so it needs no link. */
  here?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const stop = useStopTimeEntry();
  const taskKey = formatTaskKey(timer.projectSlug, timer.taskNumber);

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs",
        className,
      )}
    >
      <Timer aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1">
        {here ? (
          <span className="truncate text-muted-foreground">
            {t("tasks:timeTracking.timerRunning")}
          </span>
        ) : (
          <Link
            to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
            params={{
              workspaceId,
              projectId: timer.projectId,
              taskId: timer.taskId,
            }}
            title={timer.taskTitle}
            className="truncate text-muted-foreground hover:text-foreground hover:underline"
          >
            {t("tasks:timeTracking.timerRunningOn", { task: taskKey })}
          </Link>
        )}
        <ElapsedTime
          startTime={timer.startTime}
          className="font-medium tabular-nums"
        />
      </div>
      <Button
        variant="outline"
        size="xs"
        disabled={stop.isPending}
        onClick={() =>
          stop.mutate(
            { id: timer.id, taskId: timer.taskId },
            {
              onSuccess: (stopped) =>
                toast.success(
                  t("tasks:timeTracking.timerStopped", {
                    total: formatLoggedTime(stopped.duration ?? 0, t),
                  }),
                ),
              onError: () =>
                toast.error(t("tasks:timeTracking.timerStopError")),
            },
          )
        }
      >
        <Square aria-hidden />
        {t("tasks:timeTracking.stopTimer")}
      </Button>
    </div>
  );
}
