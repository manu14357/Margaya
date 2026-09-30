import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import FavoriteButton from "@/components/favorite/favorite-button";
import { cn } from "@/lib/cn";
import type { Module } from "@/types/module";
import {
  ModuleLeadAvatar,
  ModuleProgressRing,
  ModuleStatusChip,
  useModuleDateText,
} from "./module-bits";
import ModuleRowActions from "./module-row-actions";

type ModuleRowProps = {
  module: Module;
  workspaceId: string;
  /** A drag handle, when the list can be reordered. */
  handle?: ReactNode;
  className?: string;
};

/** One module in the list; the whole row opens the module. */
export default function ModuleRow({
  module,
  workspaceId,
  handle,
  className,
}: ModuleRowProps) {
  const { t } = useTranslation();
  const dateText = useModuleDateText();
  const scope = module.counts.total - module.counts.cancelled;

  return (
    <div
      className={cn(
        "group relative flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 bg-card px-3 py-1.5 transition-colors hover:bg-accent/40 md:px-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 basis-60 items-center gap-2.5">
        {handle}
        <ModuleProgressRing module={module} />
        <Link
          to="/dashboard/workspace/$workspaceId/project/$projectId/modules/$moduleId"
          params={{
            workspaceId,
            projectId: module.projectId,
            moduleId: module.id,
          }}
          className="min-w-0 truncate font-medium text-sm outline-none after:absolute after:inset-0 focus-visible:underline"
        >
          {module.name}
        </Link>
        <span className="hidden shrink-0 text-muted-foreground text-xs md:inline">
          {dateText(module.startDate, module.targetDate)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <ModuleStatusChip module={module} className="relative z-10" />
        <ModuleLeadAvatar lead={module.lead} />
        <span
          className="hidden w-16 text-muted-foreground text-xs tabular-nums sm:inline"
          title={t("modules:row.doneOfScope", {
            done: module.counts.completed,
            scope,
          })}
        >
          {module.counts.completed}/{scope}
        </span>
        <span className="relative z-10 flex items-center">
          {!module.archivedAt && (
            <FavoriteButton
              workspaceId={workspaceId}
              entityType="module"
              entityId={module.id}
              placeholder={{
                name: module.name,
                projectId: module.projectId,
                feature: "modules",
              }}
            />
          )}
          <ModuleRowActions module={module} workspaceId={workspaceId} />
        </span>
      </div>
    </div>
  );
}
