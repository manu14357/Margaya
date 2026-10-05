import { ArchiveRestore, Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { formatRelativeTime } from "@/lib/format";
import { generateLink } from "@/lib/generate-link";
import { taskKeyPath } from "@/lib/task-key";
import { toast } from "@/lib/toast";

type ArchivedTaskRowEndProps = {
  row: {
    id: string;
    projectId: string;
    title: string;
    /** WEB-12: the copied link is the readable one when known. */
    key?: string;
    archivedAt?: string | null;
  };
  workspaceId: string;
  canRestore: boolean;
  canDelete: boolean;
  onRestore: () => void;
  onDelete: () => void;
};

const stop = (event: React.SyntheticEvent) => event.stopPropagation();

/** "Archived 3 days ago", then Restore and a menu, at a row's end. */
export default function ArchivedTaskRowEnd({
  row,
  workspaceId,
  canRestore,
  canDelete,
  onRestore,
  onDelete,
}: ArchivedTaskRowEndProps) {
  const { t } = useTranslation();

  const copyLink = () =>
    void copyToClipboard(
      generateLink(
        row.key
          ? taskKeyPath(workspaceId, row.key)
          : `/dashboard/workspace/${workspaceId}/project/${row.projectId}/task/${row.id}`,
      ),
    ).then((copied) => {
      if (copied) toast.success(t("tasks:contextMenu.copyLinkSuccess"));
    });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keeps row clicks off the actions
    <div
      className="flex flex-shrink-0 items-center gap-1"
      onClick={stop}
      onKeyDown={stop}
    >
      {row.archivedAt && (
        <span className="hidden whitespace-nowrap text-right text-muted-foreground text-xs sm:inline">
          {t("workspace:archives.archivedAgo", {
            time: formatRelativeTime(row.archivedAt),
          })}
        </span>
      )}
      {/* Restoring is this list's main action: always visible, also on touch. */}
      {canRestore && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("workspace:archives.actions.restoreAria", {
            name: row.title,
          })}
          title={t("workspace:archives.actions.restore")}
          className="text-muted-foreground hover:text-foreground"
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
              className="text-muted-foreground hover:text-foreground"
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {canRestore && (
            <DropdownMenuItem onClick={onRestore}>
              <ArchiveRestore />
              {t("workspace:archives.actions.restore")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={copyLink}>
            <Link2 />
            {t("workspace:archives.actions.copyLink")}
          </DropdownMenuItem>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                <Trash2 />
                {t("workspace:archives.actions.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
