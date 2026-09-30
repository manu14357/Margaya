import { useTranslation } from "react-i18next";
import {
  ContextMenuCheckboxItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useSetTaskModules } from "@/hooks/mutations/module/use-set-task-modules";
import { useModuleTaskIndex } from "@/hooks/queries/module/use-get-module-task-map";
import useGetModules from "@/hooks/queries/module/use-get-modules";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { moduleOptionGroups } from "@/lib/module/options";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";
import { ModuleStatusIcon } from "./module-status";

/**
 * The "Modules" submenu of the task card and row menu: one checkable row
 * per active module. Each click saves at once; the menu stays open so
 * several modules can be toggled.
 */
export default function TaskModulesContextSubmenu({
  task,
  projectId,
}: TaskPropertySlotProps["contextMenu"]) {
  const { t } = useTranslation();
  const { canUpdateModules, isCheckingPermissions } = useWorkspacePermission();
  const { data: modules = [] } = useGetModules(projectId);
  const { modulesByTask } = useModuleTaskIndex(projectId, {
    enabled: modules.length > 0,
  });
  const { mutate: setTaskModules } = useSetTaskModules();

  if (isCheckingPermissions || !canUpdateModules() || modules.length === 0) {
    return null;
  }

  const current = modulesByTask.get(task.id) ?? [];
  const toggle = (moduleId: string) => {
    const isIn = current.includes(moduleId);
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

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <span>{t("modules:picker.label")}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-56">
        {moduleOptionGroups(modules).flatMap((group) =>
          group.modules.map((module) => (
            <ContextMenuCheckboxItem
              key={module.id}
              checked={current.includes(module.id)}
              onCheckedChange={() => toggle(module.id)}
            >
              <ModuleStatusIcon status={module.status} className="size-3.5" />
              <span className="truncate">{module.name}</span>
            </ContextMenuCheckboxItem>
          )),
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
