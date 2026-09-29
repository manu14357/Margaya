import { Download, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatDateMedium,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
} from "@/lib/format";
import { formatBytes } from "@/lib/format-bytes";
import { getInitials } from "@/lib/get-initials";
import { canDownload, displayExportStatus } from "@/lib/task-export/status";
import type { TaskExport, TaskExportFormat } from "@/types/task-export";
import { ExportStatusBadge } from "./export-status-badge";

const FORMAT_NAME_KEYS = {
  csv: "settings:workspaceExports.formats.csv",
  xlsx: "settings:workspaceExports.formats.xlsx",
  json: "settings:workspaceExports.formats.json",
} as const satisfies Record<TaskExportFormat, string>;

type ExportHistoryRowProps = {
  row: TaskExport;
  now: Date;
  showRequester: boolean;
  isDownloading: boolean;
  onDownload: () => void;
  onDelete: () => void;
};

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

export function ExportHistoryRow({
  row,
  now,
  showRequester,
  isDownloading,
  onDownload,
  onDelete,
}: ExportHistoryRowProps) {
  const { t } = useTranslation();
  const status = displayExportStatus(row, now);
  const downloadable = canDownload(row, now);
  const summary = t("settings:workspaceExports.history.summaryProjects", {
    count: row.projectIds.length,
    format: t(FORMAT_NAME_KEYS[row.format]),
    name:
      row.projects[0]?.name ??
      t("settings:workspaceExports.history.deletedProject"),
  });

  return (
    <TableRow>
      <TableCell className="max-w-56">
        <span className="block truncate font-medium" title={summary}>
          {summary}
        </span>
      </TableCell>
      {showRequester && (
        <TableCell>
          {row.requestedBy ? (
            <span className="inline-flex min-w-0 items-center gap-2">
              <Avatar className="size-5">
                <AvatarImage src={row.requestedBy.image ?? ""} alt="" />
                <AvatarFallback className="bg-muted text-[0.625rem]">
                  {getInitials(row.requestedBy.name)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{row.requestedBy.name}</span>
            </span>
          ) : (
            <Muted>—</Muted>
          )}
        </TableCell>
      )}
      <TableCell>
        <Tooltip>
          <TooltipTrigger
            render={
              <time
                dateTime={row.createdAt}
                className="cursor-default whitespace-nowrap text-muted-foreground"
              />
            }
          >
            {/* The real clock: the minute tick can trail a row just created. */}
            {formatRelativeTime(row.createdAt)}
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(row.createdAt)}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
        <ExportStatusBadge status={status} error={row.error} />
      </TableCell>
      <TableCell className="hidden text-right tabular-nums md:table-cell">
        {row.taskCount === null ? (
          <Muted>—</Muted>
        ) : (
          formatNumber(row.taskCount)
        )}
      </TableCell>
      <TableCell className="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
        {row.sizeBytes ? formatBytes(row.sizeBytes) : <Muted>—</Muted>}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {row.expiresAt && (status === "completed" || status === "expired") ? (
          <Muted>
            {downloadable
              ? t("settings:workspaceExports.history.expiresOn", {
                  date: formatDateMedium(row.expiresAt),
                })
              : t("settings:workspaceExports.history.expiredOn", {
                  date: formatDateMedium(row.expiresAt),
                })}
          </Muted>
        ) : (
          <Muted>—</Muted>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex items-center gap-1">
          {downloadable && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onDownload}
              disabled={isDownloading}
              aria-label={t("settings:workspaceExports.history.downloadAria", {
                name: row.fileName ?? summary,
              })}
              title={t("settings:workspaceExports.history.download")}
            >
              {isDownloading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={row.status === "processing"}
            aria-label={t("settings:workspaceExports.history.deleteAria", {
              name: row.fileName ?? summary,
            })}
            title={t("settings:workspaceExports.history.delete")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default ExportHistoryRow;
