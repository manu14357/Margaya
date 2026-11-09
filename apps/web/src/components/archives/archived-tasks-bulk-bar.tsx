import { ArchiveRestore, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BulkBarFrame } from "@/components/bulk-selection/bulk-bar-frame";
import { Button } from "@/components/ui/button";
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import { useArchivedTaskBulk } from "@/hooks/mutations/archive/use-archived-task-bulk";
import { useLiftToasts } from "@/hooks/use-lift-toasts";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";

type ArchivedTasksBulkBarProps = {
  canRestore: boolean;
  canDelete: boolean;
  /** The ids leave the list at once... */
  onRestored: (ids: string[]) => void;
  /** ...and come back when restoring fails. */
  onRestoreFailed: (ids: string[]) => void;
  /** Asks to confirm deleting these ids. */
  onDelete: (ids: string[]) => void;
};

/** The floating bar of a selection of archived tasks: Restore and Delete. */
export default function ArchivedTasksBulkBar({
  canRestore,
  canDelete,
  onRestored,
  onRestoreFailed,
  onDelete,
}: ArchivedTasksBulkBarProps) {
  const { t } = useTranslation();
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  useLiftToasts(bar);
  const { selectedTaskIds, clearSelection } = useBulkSelectionStore();
  const { restore } = useArchivedTaskBulk();
  const count = selectedTaskIds.size;

  useEffect(() => {
    if (count === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [count, clearSelection]);

  if (count === 0 || (!canRestore && !canDelete)) return null;

  const handleRestore = () => {
    const ids = [...selectedTaskIds];
    onRestored(ids);
    clearSelection();
    restore.mutate(ids, {
      onSuccess: () =>
        toast.success(
          t("workspace:archives.toast.tasksRestored", { count: ids.length }),
        ),
      onError: () => {
        onRestoreFailed(ids);
        toast.error(t("workspace:archives.toast.tasksRestoreError"));
      },
    });
  };

  return (
    <BulkBarFrame ref={setBar}>
      <Toolbar className="items-center gap-1 rounded-xl border-border/80 bg-background px-1.5 py-1 shadow-lg/8">
        <ToolbarGroup className="px-1.5">
          <span className="font-medium text-foreground text-sm">
            {t("workspace:archives.bulk.selected", { count })}
          </span>
        </ToolbarGroup>
        {canRestore && (
          <>
            <ToolbarSeparator orientation="vertical" className="my-1 h-5" />
            <ToolbarGroup>
              <Button size="sm" variant="ghost" onClick={handleRestore}>
                <ArchiveRestore className="size-4" />
                {t("workspace:archives.bulk.restore")}
              </Button>
            </ToolbarGroup>
          </>
        )}
        {canDelete && (
          <>
            <ToolbarSeparator orientation="vertical" className="my-1 h-5" />
            <ToolbarGroup>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete([...selectedTaskIds])}
              >
                <Trash2 className="size-4" />
                {t("workspace:archives.bulk.delete")}
              </Button>
            </ToolbarGroup>
          </>
        )}
        <ToolbarSeparator orientation="vertical" className="my-1 h-5" />
        <ToolbarGroup>
          <Button
            size="sm"
            variant="ghost"
            onClick={clearSelection}
            aria-label={t("tasks:bulk.clearSelection")}
          >
            <X className="size-4" />
          </Button>
        </ToolbarGroup>
      </Toolbar>
    </BulkBarFrame>
  );
}
