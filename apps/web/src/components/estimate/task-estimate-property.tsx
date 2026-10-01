import { Ruler } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useActiveEstimate } from "@/hooks/queries/estimate/use-active-estimate";
import { cn } from "@/lib/cn";
import { formatEstimateValue } from "@/lib/estimate/format";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import TaskEstimatePopover from "./task-estimate-popover";

/**
 * The "Estimate" row of the task properties sidebar. Absent (not disabled)
 * unless the project's estimates are active.
 */
export default function TaskEstimateProperty({
  task,
  layout,
  projectId,
  workspaceId,
}: TaskPropertySlotProps["sidebar"]) {
  const { t } = useTranslation();
  const { estimate, pointsById, isFetching, refetch } = useActiveEstimate({
    projectId,
    workspaceId,
  });
  const pointId = task.estimatePointId ?? null;
  const point = pointId ? pointsById.get(pointId) : undefined;

  // A point the cached system doesn't know yet (another tab just added it):
  // show "No estimate" and refetch the systems once.
  const refetchedFor = useRef<string | null>(null);
  const isUnknownPoint = Boolean(estimate && pointId && !point);
  useEffect(() => {
    if (!isUnknownPoint || !pointId || isFetching) return;
    if (refetchedFor.current === pointId) return;
    refetchedFor.current = pointId;
    void refetch();
  }, [isUnknownPoint, pointId, isFetching, refetch]);

  if (!estimate) return null;

  return (
    <TaskEstimatePopover task={{ ...task, projectId }} estimate={estimate}>
      <Button
        variant="ghost"
        size="sm"
        title={t("tasks:estimate.label")}
        className={cn(
          "h-7 justify-start gap-1.5 px-1.5",
          layout === "stack" && "w-full",
        )}
      >
        <Ruler className="size-3.5 text-muted-foreground" />
        <span
          className={cn(
            "max-w-40 truncate font-semibold text-xs",
            !point && "text-muted-foreground",
          )}
        >
          {point
            ? formatEstimateValue(estimate.type, point.value, {
                withUnit: true,
                t,
              })
            : t("tasks:estimate.none")}
        </span>
      </Button>
    </TaskEstimatePopover>
  );
}
