import { Ruler } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ContextMenuCheckboxItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useUpdateTaskEstimate } from "@/hooks/mutations/estimate/use-update-task-estimate";
import { useActiveEstimate } from "@/hooks/queries/estimate/use-active-estimate";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatEstimateValue } from "@/lib/estimate/format";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";

/**
 * The "Estimate" submenu of the task card and row menu: "No estimate", then
 * the active system's values. Hidden unless estimates are active and the
 * user can update tasks.
 */
export default function TaskEstimateContextSubmenu({
  task,
  projectId,
  workspaceId,
}: TaskPropertySlotProps["contextMenu"]) {
  const { t } = useTranslation();
  const { canUpdateTasks, isCheckingPermissions } = useWorkspacePermission();
  const { estimate } = useActiveEstimate({ projectId, workspaceId });
  const { mutate: updateTaskEstimate } = useUpdateTaskEstimate();

  // Partial task objects (subtask rows) don't carry their estimate; without
  // it the menu can't show which value is current.
  if (
    isCheckingPermissions ||
    !canUpdateTasks() ||
    !estimate ||
    task.estimatePointId === undefined
  ) {
    return null;
  }

  const current = task.estimatePointId ?? null;

  const select = (pointId: string | null) => {
    if (pointId === current) return;
    updateTaskEstimate(
      { taskId: task.id, projectId, estimatePointId: pointId },
      {
        onSuccess: () => toast.success(t("tasks:update.success")),
        onError: (error) =>
          toast.error(error.message || t("tasks:estimate.updateError")),
      },
    );
  };

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <span>{t("tasks:contextMenu.estimate")}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-48">
        <ContextMenuCheckboxItem
          checked={current === null}
          onCheckedChange={() => select(null)}
          closeOnClick
        >
          <Ruler className="size-3.5 text-muted-foreground" />
          <span>{t("tasks:estimate.none")}</span>
        </ContextMenuCheckboxItem>
        {[...estimate.points]
          .sort((a, b) => a.position - b.position)
          .map((point) => (
            <ContextMenuCheckboxItem
              key={point.id}
              checked={current === point.id}
              onCheckedChange={() => select(point.id)}
              closeOnClick
            >
              <Ruler className="size-3.5 text-muted-foreground" />
              <span className="truncate">
                {formatEstimateValue(estimate.type, point.value, {
                  withUnit: true,
                  t,
                })}
              </span>
            </ContextMenuCheckboxItem>
          ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
