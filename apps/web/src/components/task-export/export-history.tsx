import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ErrorDisplay } from "@/components/ui/error-display";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import { useDeleteTaskExport } from "@/hooks/mutations/task-export/use-delete-task-export";
import { useDownloadTaskExport } from "@/hooks/mutations/task-export/use-download-task-export";
import { useTaskExports } from "@/hooks/queries/task-export/use-task-exports";
import { useCurrentMinute } from "@/hooks/use-current-minute";
import { toast } from "@/lib/toast";
import type { TaskExport, TaskExportScope } from "@/types/task-export";
import { ExportHistoryRow } from "./export-history-row";

type ExportHistoryProps = {
  workspaceId: string;
  /** workspace:manage_settings: the "All exports" view. */
  canSeeAll: boolean;
  retentionDays: number;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** "Previous exports": the caller's history, or everyone's for admins. */
export function ExportHistory({
  workspaceId,
  canSeeAll,
  retentionDays,
}: ExportHistoryProps) {
  const { t } = useTranslation();
  const now = useCurrentMinute();
  const [chosenScope, setChosenScope] = useState<TaskExportScope>("mine");
  const scope: TaskExportScope = canSeeAll ? chosenScope : "mine";
  const history = useTaskExports(workspaceId, scope);
  const deleteExport = useDeleteTaskExport(workspaceId);
  const download = useDownloadTaskExport();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TaskExport | null>(null);

  const rows = useMemo(
    () => history.data?.pages.flatMap((page) => page.items) ?? [],
    [history.data],
  );
  const showRequester = scope === "all";

  const handleDownload = (row: TaskExport) => {
    setDownloadingId(row.id);
    download.mutate(
      { id: row.id, fileName: row.fileName },
      {
        onError: (error) =>
          toast.error(
            errorMessage(
              error,
              t("settings:workspaceExports.toast.downloadError"),
            ),
          ),
        onSettled: () => setDownloadingId(null),
      },
    );
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    deleteExport.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("settings:workspaceExports.toast.deleted"));
        setPendingDelete(null);
      },
      onError: (error) =>
        toast.error(
          errorMessage(error, t("settings:workspaceExports.toast.deleteError")),
        ),
    });
  };

  let body: React.ReactNode;
  if (history.isLoading) {
    body = (
      <Frame>
        <FramePanel className="space-y-3 p-4">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </FramePanel>
      </Frame>
    );
  } else if (history.isError) {
    body = (
      <ErrorDisplay
        error={history.error}
        onRetry={() => void history.refetch()}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <Frame>
        <FramePanel className="p-8">
          <p className="text-center text-muted-foreground text-sm">
            {t("settings:workspaceExports.history.empty", {
              days: retentionDays,
            })}
          </p>
        </FramePanel>
      </Frame>
    );
  } else {
    body = (
      <div className="space-y-3">
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("settings:workspaceExports.history.columns.export")}
                </TableHead>
                {showRequester && (
                  <TableHead>
                    {t("settings:workspaceExports.history.columns.requestedBy")}
                  </TableHead>
                )}
                <TableHead>
                  {t("settings:workspaceExports.history.columns.created")}
                </TableHead>
                <TableHead>
                  {t("settings:workspaceExports.history.columns.status")}
                </TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  {t("settings:workspaceExports.history.columns.tasks")}
                </TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  {t("settings:workspaceExports.history.columns.size")}
                </TableHead>
                <TableHead>
                  {t("settings:workspaceExports.history.columns.expires")}
                </TableHead>
                <TableHead className="w-[90px] text-right">
                  {t("settings:workspaceExports.history.columns.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <ExportHistoryRow
                  key={row.id}
                  row={row}
                  now={now}
                  showRequester={showRequester}
                  isDownloading={downloadingId === row.id}
                  onDownload={() => handleDownload(row)}
                  onDelete={() => setPendingDelete(row)}
                />
              ))}
            </TableBody>
          </Table>
        </Frame>
        {history.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              {t("settings:workspaceExports.history.loadMore")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {canSeeAll && (
        <ToggleGroup
          size="sm"
          variant="outline"
          aria-label={t("settings:workspaceExports.history.scopeLabel")}
          value={[scope]}
          onValueChange={(values) => {
            const next = values[0];
            if (next === "mine" || next === "all") setChosenScope(next);
          }}
        >
          <Toggle value="mine">
            {t("settings:workspaceExports.history.mine")}
          </Toggle>
          <Toggle value="all">
            {t("settings:workspaceExports.history.all")}
          </Toggle>
        </ToggleGroup>
      )}

      {body}

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deleteExport.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:workspaceExports.history.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:workspaceExports.history.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteExport.isPending}
            >
              {deleteExport.isPending
                ? t("settings:workspaceExports.history.deleting")
                : t("settings:workspaceExports.history.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default ExportHistory;
