import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useModuleTaskIndex } from "@/hooks/queries/module/use-get-module-task-map";
import useGetModules from "@/hooks/queries/module/use-get-modules";
import type { TaskPropertySlotProps } from "@/lib/task-property-slots";
import { useModuleScope } from "./module-scope-context";
import { ModuleStatusIcon } from "./module-status";

const MAX_CHIPS = 2;
const MAX_NAME_LENGTH = 14;

function truncateName(name: string) {
  return name.length > MAX_NAME_LENGTH
    ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…`
    : name;
}

/**
 * A task card's or row's module chips: up to two names, then "+N". The
 * module whose page is open is left out, since every task there is in it.
 */
export default function TaskCardModuleChips({
  task,
  projectId,
}: TaskPropertySlotProps["cardChip"]) {
  const { t } = useTranslation();
  const scope = useModuleScope();
  const { data: modules = [] } = useGetModules(projectId);
  // The task map loads only once the project has an active module.
  const { modulesByTask } = useModuleTaskIndex(projectId, {
    enabled: modules.length > 0,
  });
  const byId = useMemo(
    () => new Map(modules.map((module) => [module.id, module])),
    [modules],
  );

  const shown = (modulesByTask.get(task.id) ?? []).flatMap((moduleId) => {
    const module =
      moduleId === scope?.moduleId ? undefined : byId.get(moduleId);
    return module ? [module] : [];
  });
  if (shown.length === 0) return null;

  const rest = shown.slice(MAX_CHIPS);
  return (
    <TooltipProvider>
      {shown.slice(0, MAX_CHIPS).map((module) => (
        <Tooltip key={module.id}>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="h-5.5 gap-1 px-2 py-1 font-normal text-[10px] text-muted-foreground"
            >
              <ModuleStatusIcon status={module.status} className="size-3" />
              <span>{truncateName(module.name)}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {t("modules:chip.tooltip", { name: module.name })}
          </TooltipContent>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="h-5.5 px-1.5 py-1 font-normal text-[10px] text-muted-foreground"
            >
              {t("modules:chip.more", { count: rest.length })}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {t("modules:chip.moreTooltip", {
              names: rest.map((module) => module.name).join(", "),
            })}
          </TooltipContent>
        </Tooltip>
      )}
    </TooltipProvider>
  );
}
