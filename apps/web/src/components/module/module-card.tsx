import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import GroupProgressBar from "@/components/charts/group-progress-bar";
import FavoriteButton from "@/components/favorite/favorite-button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { Module } from "@/types/module";
import {
  ModuleLeadAvatar,
  ModuleStatusChip,
  useModuleDateText,
} from "./module-bits";
import ModuleRowActions from "./module-row-actions";

type ModuleCardProps = {
  module: Module;
  workspaceId: string;
  /** A drag handle, when the gallery can be reordered. */
  handle?: ReactNode;
  className?: string;
};

/** One module in the gallery; the whole card opens the module. */
export default function ModuleCard({
  module,
  workspaceId,
  handle,
  className,
}: ModuleCardProps) {
  const { t } = useTranslation();
  const dateText = useModuleDateText();
  const scope = module.counts.total - module.counts.cancelled;

  return (
    <Card
      className={cn(
        "group gap-2 p-3 transition-colors hover:bg-accent/30",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {handle}
          <Link
            to="/dashboard/workspace/$workspaceId/project/$projectId/modules/$moduleId"
            params={{
              workspaceId,
              projectId: module.projectId,
              moduleId: module.id,
            }}
            className="min-w-0 truncate font-medium text-sm outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:underline"
          >
            {module.name}
          </Link>
        </div>
        <ModuleStatusChip module={module} className="relative z-10 shrink-0" />
      </div>

      <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
        <span className="tabular-nums">
          {t("modules:row.doneOfScope", {
            done: module.counts.completed,
            scope,
          })}
        </span>
        <ModuleLeadAvatar lead={module.lead} />
      </div>

      {module.counts.total > 0 ? (
        <GroupProgressBar
          counts={module.counts}
          cancelledLabel={t("modules:sidebar.cancelledCount", {
            count: module.counts.cancelled,
          })}
        />
      ) : (
        <div className="h-2 rounded-full bg-muted" />
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-muted-foreground text-xs">
          {dateText(module.startDate, module.targetDate)}
        </span>
        <span className="relative z-10 flex shrink-0 items-center">
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
    </Card>
  );
}
