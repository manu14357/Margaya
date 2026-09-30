import { Boxes } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useGetModules from "@/hooks/queries/module/use-get-modules";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import ModuleMultiSelect from "./module-multi-select";
import { useModuleScope } from "./module-scope-context";

function moduleIdsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

/**
 * The create-task modal's modules chip. The value is a list of module ids;
 * on a module page it starts as that module, and it resets when the modal's
 * project changes. The task joins the modules once it exists.
 */
export default function ModulePickerChip({
  value,
  onChange,
  projectId,
}: TaskPropertySlotProps["createModal"]) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const scope = useModuleScope();
  const { canUpdateModules, isCheckingPermissions } = useWorkspacePermission();
  const { data: modules = [] } = useGetModules(projectId);
  const canPick = !isCheckingPermissions && canUpdateModules();

  const previousProject = useRef(projectId);
  useEffect(() => {
    if (previousProject.current === projectId) return;
    previousProject.current = projectId;
    onChange(undefined);
  }, [projectId, onChange]);

  const scopedModuleId =
    scope && scope.projectId === projectId ? scope.moduleId : null;
  useEffect(() => {
    if (value !== undefined || !canPick || !scopedModuleId) return;
    if (modules.some((module) => module.id === scopedModuleId)) {
      onChange([scopedModuleId]);
    }
  }, [value, canPick, scopedModuleId, modules, onChange]);

  if (!canPick || modules.length === 0) return null;

  const selectedIds = moduleIdsOf(value).filter((id) =>
    modules.some((module) => module.id === id),
  );
  const first = modules.find((module) => module.id === selectedIds[0]);
  const label =
    selectedIds.length === 0
      ? t("modules:picker.label")
      : selectedIds.length === 1 && first
        ? first.name
        : t("modules:picker.selectedCount", { count: selectedIds.length });

  const toggle = (moduleId: string) =>
    onChange(
      selectedIds.includes(moduleId)
        ? selectedIds.filter((id) => id !== moduleId)
        : [...selectedIds, moduleId],
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-xs transition-colors hover:bg-accent/50",
            selectedIds.length > 0
              ? "bg-accent/30 text-foreground"
              : "text-muted-foreground",
          )}
        >
          <Boxes className="size-3.5" />
          <span className="max-w-32 truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <ModuleMultiSelect
          modules={modules}
          selectedIds={selectedIds}
          onToggle={toggle}
        />
      </PopoverContent>
    </Popover>
  );
}
