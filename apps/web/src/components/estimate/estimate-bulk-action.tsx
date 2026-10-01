import { Ruler } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useBulkUpdateTaskEstimate } from "@/hooks/mutations/estimate/use-bulk-update-task-estimate";
import { useActiveEstimate } from "@/hooks/queries/estimate/use-active-estimate";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";
import EstimateOptionList from "./estimate-option-list";

/**
 * "Estimate…" in the bulk-selection toolbars: sets or clears the estimate of
 * every selected task. A selection always comes from one project's board,
 * which the bulk route requires.
 */
export default function EstimateBulkAction({
  taskIds,
  onDone,
  projectId,
  workspaceId,
}: TaskPropertySlotProps["bulkAction"]) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { canUpdateTasks, isCheckingPermissions } = useWorkspacePermission();
  const { estimate } = useActiveEstimate({ projectId, workspaceId });
  const bulkUpdate = useBulkUpdateTaskEstimate();

  if (isCheckingPermissions || !canUpdateTasks() || !estimate) return null;

  const handleSelect = async (pointId: string | null) => {
    setOpen(false);
    try {
      const result = await bulkUpdate.mutateAsync({
        projectId,
        taskIds,
        estimatePointId: pointId,
      });
      toast.success(
        t("tasks:estimate.bulk.updated", { count: result.updatedCount }),
      );
      onDone();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("tasks:estimate.bulk.error"),
      );
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" disabled={bulkUpdate.isPending}>
          <Ruler className="size-4" />
          {t("tasks:estimate.bulk.action")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="center">
        <EstimateOptionList
          estimate={estimate}
          selectedId={undefined}
          onSelect={(pointId) => void handleSelect(pointId)}
        />
      </PopoverContent>
    </Popover>
  );
}
