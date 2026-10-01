import { Ruler } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useActiveEstimate } from "@/hooks/queries/estimate/use-active-estimate";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { formatEstimateValue } from "@/lib/estimate/format";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import EstimateOptionList from "./estimate-option-list";

/**
 * The create-task modal's estimate chip. The value is a point id, or
 * undefined for no estimate; it resets when the modal's project changes.
 * Hidden unless the project's estimates are active.
 */
export default function EstimatePickerChip({
  value,
  onChange,
  projectId,
  workspaceId,
}: TaskPropertySlotProps["createModal"]) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { canUpdateTasks } = useWorkspacePermission();
  const { estimate, pointsById } = useActiveEstimate({
    projectId,
    workspaceId,
  });

  const previousProject = useRef(projectId);
  useEffect(() => {
    if (previousProject.current === projectId) return;
    previousProject.current = projectId;
    onChange(undefined);
  }, [projectId, onChange]);

  const selectedId = typeof value === "string" ? value : null;
  const selected = selectedId ? pointsById.get(selectedId) : undefined;

  // A value the system no longer has (it was switched meanwhile) is dropped.
  useEffect(() => {
    if (estimate && selectedId && !selected) onChange(undefined);
  }, [estimate, selectedId, selected, onChange]);

  if (!estimate || !canUpdateTasks()) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("tasks:estimate.setAria")}
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-xs transition-colors hover:bg-accent/50",
            selected ? "bg-accent/30 text-foreground" : "text-muted-foreground",
          )}
        >
          <Ruler className="size-3.5" />
          <span className="max-w-32 truncate">
            {selected
              ? formatEstimateValue(estimate.type, selected.value, {
                  withUnit: true,
                  t,
                })
              : t("tasks:estimate.label")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <EstimateOptionList
          estimate={estimate}
          selectedId={selectedId}
          onSelect={(pointId) => {
            onChange(pointId ?? undefined);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
