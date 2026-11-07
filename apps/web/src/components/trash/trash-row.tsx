import { ArchiveRestore, MoreHorizontal, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { formatDateMedium, formatRelativeTime } from "@/lib/format";

export type TrashRowItem = {
  id: string;
  /** The task key or project key, shown before the name; null hides it. */
  label: string | null;
  name: string;
  /** "with 2 sub-tasks" or "12 tasks"; null hides it. */
  detail: string | null;
  deletedAt: string;
  deletedBy: { id: string; name: string } | null;
  purgeAt: string | null;
  /** False hides the actions on this row, whatever the list allows. */
  canAct?: boolean;
};

type TrashRowProps = {
  item: TrashRowItem;
  icon: ReactNode;
  canAct: boolean;
  onRestore: () => void;
  onPurge: () => void;
};

/** One trashed task, project or page: who deleted it and when, Restore, Delete. */
export default function TrashRow({
  item,
  icon,
  canAct,
  onRestore,
  onPurge,
}: TrashRowProps) {
  const { t } = useTranslation();
  const when = formatRelativeTime(item.deletedAt);
  const deletedLine = item.deletedBy
    ? t("settings:trash.deletedBy", { name: item.deletedBy.name, time: when })
    : t("settings:trash.deletedAt", { time: when });

  return (
    <li className="flex min-h-11 items-center gap-3 border-border/50 border-b px-3 py-2 last:border-b-0 md:px-4">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {item.label && (
            <span className="shrink-0 font-mono text-muted-foreground text-xs">
              {item.label}
            </span>
          )}
          <span className="min-w-0 truncate font-medium text-sm">
            {item.name}
          </span>
          {item.detail && (
            <span className="hidden shrink-0 text-muted-foreground text-xs sm:inline">
              {item.detail}
            </span>
          )}
        </div>
        {/* Wraps rather than truncates, so the purge date stays visible. */}
        <p className="text-muted-foreground text-xs">
          {deletedLine}
          {item.purgeAt &&
            ` · ${t("settings:trash.purgeOn", {
              date: formatDateMedium(item.purgeAt),
            })}`}
        </p>
      </div>
      {canAct && item.canAct !== false && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            aria-label={t("settings:trash.restoreAria", { name: item.name })}
            onClick={onRestore}
          >
            <ArchiveRestore className="size-4" />
            <span className="hidden sm:inline">
              {t("settings:trash.restore")}
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("settings:trash.menuAria", { name: item.name })}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem className="text-destructive" onClick={onPurge}>
                <Trash2 />
                {t("settings:trash.deletePermanently")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  );
}
