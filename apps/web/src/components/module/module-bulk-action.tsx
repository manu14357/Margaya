import { Boxes, SquareMinus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAddModuleTasks } from "@/hooks/mutations/module/use-add-module-tasks";
import { useRemoveModuleTasks } from "@/hooks/mutations/module/use-remove-module-tasks";
import useGetModules from "@/hooks/queries/module/use-get-modules";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";
import ModuleMultiSelect from "./module-multi-select";
import { useModuleScope } from "./module-scope-context";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * "Add to module…" in the bulk-selection toolbars, plus "Remove from module"
 * on a module's page. Calls go out in batches of 200.
 */
export default function ModuleBulkAction({
  taskIds,
  onDone,
  projectId,
}: TaskPropertySlotProps["bulkAction"]) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const scope = useModuleScope();
  const { canUpdateModules, isCheckingPermissions } = useWorkspacePermission();
  const { data: modules = [] } = useGetModules(projectId);
  const addTasks = useAddModuleTasks();
  const removeTasks = useRemoveModuleTasks();

  const scopedModule =
    scope && scope.projectId === projectId
      ? modules.find((module) => module.id === scope.moduleId)
      : undefined;
  if (isCheckingPermissions || !canUpdateModules() || modules.length === 0) {
    return null;
  }

  const isPending = addTasks.isPending || removeTasks.isPending;

  const handleAdd = async (moduleId: string) => {
    setOpen(false);
    const target = modules.find((module) => module.id === moduleId);
    try {
      const change = await addTasks.mutateAsync({
        moduleId,
        projectId,
        taskIds,
      });
      toast.success(
        t("modules:toast.tasksAdded", {
          count: change.added.length,
          name: target?.name ?? "",
        }),
      );
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, t("modules:bulk.error")));
    }
  };

  const handleRemove = async () => {
    if (!scopedModule) return;
    try {
      const change = await removeTasks.mutateAsync({
        moduleId: scopedModule.id,
        projectId,
        taskIds,
      });
      toast.success(
        t("modules:toast.tasksRemoved", {
          count: change.removed.length,
          name: scopedModule.name,
        }),
      );
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, t("modules:bulk.error")));
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" disabled={isPending}>
            <Boxes className="size-4" />
            {t("modules:bulk.addToModule")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center">
          <p className="border-border border-b px-2 py-1.5 font-medium text-muted-foreground text-xs">
            {t("modules:bulk.chooseModule")}
          </p>
          <ModuleMultiSelect
            modules={modules}
            selectedIds={[]}
            onToggle={(moduleId) => void handleAdd(moduleId)}
          />
        </PopoverContent>
      </Popover>
      {scopedModule && (
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => void handleRemove()}
        >
          <SquareMinus className="size-4" />
          {t("modules:bulk.removeFromModule")}
        </Button>
      )}
    </>
  );
}
