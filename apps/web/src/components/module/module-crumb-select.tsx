import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import useGetModules from "@/hooks/queries/module/use-get-modules";
import { moduleOptionGroups } from "@/lib/module/options";
import { MODULE_STATUS_META } from "@/lib/module/status";
import { ModuleStatusIcon } from "./module-status";

type ModuleCrumbSelectProps = {
  workspaceId: string;
  projectId: string;
  moduleId: string;
  moduleName?: string;
  panel?: "closed";
};

/** "Modules / {module} ▾": back to the list, or switch to another module. */
export default function ModuleCrumbSelect({
  workspaceId,
  projectId,
  moduleId,
  moduleName,
  panel,
}: ModuleCrumbSelectProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: modules = [] } = useGetModules(projectId);
  const groups = moduleOptionGroups(modules);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Link
        to="/dashboard/workspace/$workspaceId/project/$projectId/modules"
        params={{ workspaceId, projectId }}
        className="rounded-md px-2 py-1 text-foreground/80 text-xs hover:bg-accent hover:text-foreground"
      >
        {t("modules:nav.title")}
      </Link>
      <span className="text-foreground/30 text-xs">/</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              aria-label={t("modules:detail.switchModule")}
              className="h-7 max-w-56 justify-between gap-2 px-2 text-foreground text-xs"
            />
          }
        >
          <span className="truncate">{moduleName ?? "…"}</span>
          <ChevronsUpDown className="size-3 text-foreground/70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-96 w-72" align="start">
          {groups.map((group, index) => (
            <Fragment key={group.status}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
                  {t(MODULE_STATUS_META[group.status].labelKey)}
                </DropdownMenuLabel>
                {group.modules.map((module) => (
                  <DropdownMenuItem
                    key={module.id}
                    disabled={module.id === moduleId}
                    className="h-8 gap-2 text-sm"
                    onClick={() =>
                      navigate({
                        to: "/dashboard/workspace/$workspaceId/project/$projectId/modules/$moduleId",
                        params: { workspaceId, projectId, moduleId: module.id },
                        search: panel ? { panel } : {},
                      })
                    }
                  >
                    <ModuleStatusIcon status={module.status} />
                    <span className="truncate">{module.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
