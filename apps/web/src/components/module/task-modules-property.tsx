import { Link } from "@tanstack/react-router";
import { Boxes, Plus } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSetTaskModules } from "@/hooks/mutations/module/use-set-task-modules";
import useGetModules from "@/hooks/queries/module/use-get-modules";
import useGetTaskModules from "@/hooks/queries/module/use-get-task-modules";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";
import type { Module } from "@/types/module";
import ModuleMultiSelect from "./module-multi-select";
import { ModuleStatusIcon } from "./module-status";

type ModulesPopoverProps = {
  modules: readonly Module[];
  selectedIds: readonly string[];
  onToggle: (moduleId: string) => void;
  children: ReactElement;
};

function ModulesPopover({
  modules,
  selectedIds,
  onToggle,
  children,
}: ModulesPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <ModuleMultiSelect
          modules={modules}
          selectedIds={selectedIds}
          onToggle={onToggle}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The "Modules" property of the task sidebar: chips linking to the task's
 * modules and a picker that saves each toggle at once.
 */
export default function TaskModulesProperty({
  task,
  layout,
  projectId,
  workspaceId,
}: TaskPropertySlotProps["sidebar"]) {
  const { t } = useTranslation();
  const { canUpdateModules, canCreateModules, isCheckingPermissions } =
    useWorkspacePermission();
  const { data: modules = [], isSuccess } = useGetModules(projectId);
  const { data: refs = [] } = useGetTaskModules(projectId, task.id);
  const { mutate: setTaskModules } = useSetTaskModules();
  const canEdit = !isCheckingPermissions && canUpdateModules();

  // Nothing to show or pick: no modules yet, and nobody here to create one.
  if (isSuccess && modules.length === 0 && refs.length === 0) {
    if (isCheckingPermissions || !canCreateModules()) return null;
  }

  const selectedIds = refs.map((ref) => ref.id);
  const toggle = (moduleId: string) => {
    const isIn = selectedIds.includes(moduleId);
    setTaskModules(
      {
        taskId: task.id,
        projectId,
        ...(isIn
          ? { removeModuleIds: [moduleId] }
          : { addModuleIds: [moduleId] }),
      },
      { onError: () => toast.error(t("modules:toast.membershipError")) },
    );
  };

  if (layout === "row") {
    const label =
      refs.length === 0
        ? t("modules:picker.none")
        : refs.length === 1
          ? refs[0].name
          : t("modules:picker.selectedCount", { count: refs.length });
    const trigger = (
      <Button
        variant="ghost"
        size="sm"
        title={t("modules:picker.label")}
        className="h-7 justify-start gap-1.5 px-1.5"
      >
        <Boxes className="size-3.5 text-muted-foreground" />
        <span
          className={cn(
            "max-w-40 truncate font-semibold text-xs",
            refs.length === 0 && "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </Button>
    );
    return canEdit ? (
      <ModulesPopover
        modules={modules}
        selectedIds={selectedIds}
        onToggle={toggle}
      >
        {trigger}
      </ModulesPopover>
    ) : (
      trigger
    );
  }

  return (
    <div className="flex min-h-7 w-full flex-wrap items-center gap-1 px-1.5">
      <Boxes
        role="img"
        aria-label={t("modules:picker.label")}
        className="mr-0.5 size-3.5 shrink-0 text-muted-foreground"
      />
      {refs.length === 0 && (
        <span className="font-semibold text-muted-foreground text-xs">
          {t("modules:picker.none")}
        </span>
      )}
      {refs.map((ref) => (
        <Badge
          key={ref.id}
          variant="outline"
          className="h-5 max-w-[120px] gap-1 px-1.5 font-normal text-[10px] hover:bg-accent/50"
          render={
            <Link
              to="/dashboard/workspace/$workspaceId/project/$projectId/modules/$moduleId"
              params={{ workspaceId, projectId, moduleId: ref.id }}
            />
          }
        >
          <ModuleStatusIcon status={ref.status} className="size-3" />
          <span className="truncate">{ref.name}</span>
        </Badge>
      ))}
      {canEdit && (
        <ModulesPopover
          modules={modules}
          selectedIds={selectedIds}
          onToggle={toggle}
        >
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("modules:picker.add")}
            title={t("modules:picker.add")}
            className="size-5 rounded-full p-0"
          >
            <Plus className="size-3" />
          </Button>
        </ModulesPopover>
      )}
    </div>
  );
}
