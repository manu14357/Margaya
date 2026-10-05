import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModuleStatusIcon } from "@/components/module/module-status";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import icons from "@/constants/project-icons";
import { formatCycleRange } from "@/lib/cycle/dates";
import { formatRelativeTime } from "@/lib/format";
import { formatModuleDate } from "@/lib/module/dates";
import { isModuleStatus } from "@/lib/module/status";
import type { ArchivedEntity } from "@/types/archive";

type ArchivedEntityRowProps = {
  item: ArchivedEntity;
  /** Workspace scope: cycles and modules name their project. */
  showProject: boolean;
  onOpen: () => void;
  onRestore: () => void;
  onDelete: () => void;
};

function ProjectIcon({ icon }: { icon: string | null }) {
  const Icon = icons[(icon ?? "Layout") as keyof typeof icons] ?? icons.Layout;
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}

function EntityIcon({ item }: { item: ArchivedEntity }) {
  if (item.type === "project") return <ProjectIcon icon={item.projectIcon} />;
  if (item.type === "module" && isModuleStatus(item.details.status)) {
    return <ModuleStatusIcon status={item.details.status} />;
  }
  return <Archive className="size-4 shrink-0 text-muted-foreground" />;
}

function EntityDetails({ item }: { item: ArchivedEntity }) {
  const { t } = useTranslation();
  let text: string | null = null;
  if (item.type === "cycle") {
    text = formatCycleRange(item.details.startDate, item.details.endDate);
  } else if (item.type === "module") {
    text = item.details.targetDate
      ? formatModuleDate(item.details.targetDate)
      : null;
  } else {
    text = t("workspace:archives.taskCount", {
      count: item.details.taskCount,
    });
  }
  if (!text) return null;
  return (
    <span className="hidden shrink-0 text-muted-foreground text-xs md:inline">
      {text}
    </span>
  );
}

/** An archived cycle, module or project, with Open, Restore and Delete. */
export default function ArchivedEntityRow({
  item,
  showProject,
  onOpen,
  onRestore,
  onDelete,
}: ArchivedEntityRowProps) {
  const { t } = useTranslation();

  return (
    <div className="group relative flex min-h-9 items-center gap-3 border-border/50 border-b px-3 py-1.5 transition-colors hover:bg-accent/40 md:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <EntityIcon item={item} />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 truncate text-left font-medium text-sm outline-none after:absolute after:inset-0 focus-visible:underline"
        >
          {item.name}
        </button>
        {item.type === "project" ? (
          <span className="shrink-0 font-mono text-muted-foreground text-xs">
            {item.projectSlug.toUpperCase()}
          </span>
        ) : (
          showProject && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/80 px-1.5 py-0.5 text-muted-foreground text-xs"
              title={item.projectName}
            >
              <ProjectIcon icon={item.projectIcon} />
              <span className="font-mono">
                {item.projectSlug.toUpperCase()}
              </span>
            </span>
          )
        )}
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-2">
        <EntityDetails item={item} />
        <span className="hidden whitespace-nowrap text-right text-muted-foreground text-xs sm:inline">
          {t("workspace:archives.archivedAgo", {
            time: formatRelativeTime(item.archivedAt),
          })}
        </span>
        {item.canRestore && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("workspace:archives.actions.restoreAria", {
              name: item.name,
            })}
            title={t("workspace:archives.actions.restore")}
            onClick={onRestore}
          >
            <ArchiveRestore className="size-4" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("workspace:archives.actions.menuAria")}
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onOpen}>
              <ExternalLink />
              {t("workspace:archives.actions.open")}
            </DropdownMenuItem>
            {item.canRestore && (
              <DropdownMenuItem onClick={onRestore}>
                <ArchiveRestore />
                {t("workspace:archives.actions.restore")}
              </DropdownMenuItem>
            )}
            {item.canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 />
                  {t("workspace:archives.actions.delete")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
