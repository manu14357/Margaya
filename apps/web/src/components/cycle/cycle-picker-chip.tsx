import { IterationCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useGetCycles from "@/hooks/queries/cycle/use-get-cycles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { isAssignableCycle } from "@/lib/cycle/status";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import CycleOptionList from "./cycle-option-list";
import { useCycleScope } from "./cycle-scope-context";

/**
 * The create-task modal's cycle chip. The value is a cycle id, or null for
 * "No cycle"; on a cycle page it starts as that cycle, and it resets when
 * the modal's project changes.
 */
export default function CyclePickerChip({
  value,
  onChange,
  projectId,
}: TaskPropertySlotProps["createModal"]) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const scope = useCycleScope();
  const { canUpdateCycles } = useWorkspacePermission();
  const { data: cycles = [] } = useGetCycles(projectId);
  const canPick = canUpdateCycles();

  const previousProject = useRef(projectId);
  useEffect(() => {
    if (previousProject.current === projectId) return;
    previousProject.current = projectId;
    onChange(undefined);
  }, [projectId, onChange]);

  const scopedCycleId =
    scope && scope.projectId === projectId ? scope.cycleId : null;
  useEffect(() => {
    if (value !== undefined || !canPick || !scopedCycleId) return;
    const scoped = cycles.find((cycle) => cycle.id === scopedCycleId);
    if (scoped && isAssignableCycle(scoped)) onChange(scopedCycleId);
  }, [value, canPick, scopedCycleId, cycles, onChange]);

  if (!canPick) return null;

  const selectedId = typeof value === "string" ? value : null;
  const selected = cycles.find((cycle) => cycle.id === selectedId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-xs transition-colors hover:bg-accent/50",
            selected ? "bg-accent/30 text-foreground" : "text-muted-foreground",
          )}
        >
          <IterationCw className="size-3.5" />
          <span className="max-w-32 truncate">
            {selected?.name ?? t("cycles:picker.label")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <CycleOptionList
          cycles={cycles}
          selectedId={selectedId}
          onSelect={(cycleId) => {
            onChange(cycleId);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
