import { Ruler } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useActiveEstimate } from "@/hooks/queries/estimate/use-active-estimate";
import { formatEstimateValue } from "@/lib/estimate/format";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { useUserPreferencesStore } from "@/store/user-preferences";

/**
 * A task card's or row's estimate chip: display only, changes go through
 * the context menu. Nothing shows without an estimate, while estimates
 * aren't active, or when the "Estimates" display option is off.
 */
export default function EstimateCardChip({
  task,
  projectId,
  workspaceId,
}: TaskPropertySlotProps["cardChip"]) {
  const showEstimates = useUserPreferencesStore((state) => state.showEstimates);
  if (!showEstimates || !task.estimatePointId) return null;
  return (
    <EstimateChip
      pointId={task.estimatePointId}
      projectId={projectId}
      workspaceId={workspaceId}
    />
  );
}

function EstimateChip({
  pointId,
  projectId,
  workspaceId,
}: {
  pointId: string;
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const { estimate, pointsById } = useActiveEstimate({
    projectId,
    workspaceId,
  });
  const point = pointsById.get(pointId);
  if (!estimate || !point) return null;
  const label = formatEstimateValue(estimate.type, point.value, { t });

  return (
    <span
      title={`${t("tasks:estimate.label")}: ${label}`}
      className="inline-flex h-5.5 items-center gap-1 rounded border border-border/70 bg-muted/55 px-2 py-1 font-medium text-[10px] text-muted-foreground"
    >
      <Ruler className="size-3" />
      <span className="max-w-20 truncate">{label}</span>
    </span>
  );
}
