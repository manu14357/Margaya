import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import useCreateTimeEntry from "@/hooks/mutations/time-entry/use-create-time-entry";
import useGetRunningTimeEntry from "@/hooks/queries/time-entry/use-get-running-time-entry";
import { toast } from "@/lib/toast";
import RunningTimerBar from "./running-timer-bar";

/**
 * Start and stop in the time popover. With a timer running on another task it
 * says which, and starting here stops that one: a person has one timer.
 */
export default function TaskTimer({
  taskId,
  workspaceId,
}: {
  taskId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const start = useCreateTimeEntry();
  const { data, isLoading } = useGetRunningTimeEntry(workspaceId);
  const running = data?.entry ?? null;
  const here = running?.taskId === taskId;

  const handleStart = () =>
    start.mutate(
      { taskId, startTime: new Date().toISOString() },
      {
        onSuccess: (created) =>
          toast.success(
            t(
              created.stoppedEntries.length > 0
                ? "tasks:timeTracking.timerSwitched"
                : "tasks:timeTracking.timerStarted",
            ),
          ),
        onError: () => toast.error(t("tasks:timeTracking.timerStartError")),
      },
    );

  return (
    <div className="grid gap-2">
      {running && (
        <RunningTimerBar
          timer={running}
          workspaceId={workspaceId}
          here={here}
        />
      )}
      {!here && (
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading || start.isPending}
          onClick={handleStart}
        >
          <Play aria-hidden />
          {running
            ? t("tasks:timeTracking.startHere")
            : t("tasks:timeTracking.startTimer")}
        </Button>
      )}
    </div>
  );
}
