import { Download, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SettingsTableCell,
  SettingsTableMeta,
  SettingsTableRow,
} from "@/components/settings/settings-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CompactDate } from "@/components/ui/compact-date";
import { Spinner } from "@/components/ui/spinner";
import { formatDateMedium, formatNumber } from "@/lib/format";
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
  const isWorkspace = row.kind === "workspace";
  const summary = isWorkspace
    ? t("settings:workspaceExports.history.summaryWorkspace")
    : t("settings:workspaceExports.history.summaryProjects", {
        count: row.projectIds.length,
        format: t(FORMAT_NAME_KEYS[row.format]),
        name:
          row.projects[0]?.name ??
          t("settings:workspaceExports.history.deletedProject"),
      });

  const requester = row.requestedBy ? (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      <Avatar className="size-5 shrink-0">
        <AvatarImage src={row.requestedBy.image ?? ""} alt="" />
        <AvatarFallback className="bg-muted text-[0.625rem]">
          {getInitials(row.requestedBy.name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{row.requestedBy.name}</span>
    </span>
  ) : (
    <Muted>—</Muted>
  );
  const expires =
    row.expiresAt && (status === "completed" || status === "expired") ? (
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
    );
  const tasks =
    row.taskCount === null ? <Muted>—</Muted> : formatNumber(row.taskCount);
  const size = row.sizeBytes ? formatBytes(row.sizeBytes) : <Muted>—</Muted>;

  return (
    <SettingsTableRow>
      <SettingsTableCell kind="primary">
        <span className="block font-medium">{summary}</span>
        {isWorkspace && row.fileCount !== null && (
          <span className="block truncate text-muted-foreground text-xs">
            {row.includeFiles
              ? t("settings:workspaceExports.history.fileCount", {
                  count: row.fileCount,
                })
              : t("settings:workspaceExports.history.withoutFiles")}
          </span>
        )}
        {isWorkspace && Boolean(row.missingFileCount) && (
          <span className="block truncate text-destructive text-xs">
            {t("settings:workspaceExports.history.missingFiles", {
              count: row.missingFileCount ?? 0,
            })}
          </span>
        )}
        <SettingsTableMeta hideAbove="md">
          <span>
            {t("settings:workspaceExports.history.columns.tasks")} {tasks}
          </span>
          <span>{size}</span>
        </SettingsTableMeta>
        <SettingsTableMeta hideAbove="lg">
          {showRequester && <span className="min-w-0">{requester}</span>}
          <span>{expires}</span>
        </SettingsTableMeta>
      </SettingsTableCell>
      {showRequester && (
        <SettingsTableCell hideBelow="lg">{requester}</SettingsTableCell>
      )}
      <SettingsTableCell
        label={t("settings:workspaceExports.history.columns.created")}
        className="text-muted-foreground"
      >
        {/* The real clock: the minute tick can trail a row just created. */}
        <CompactDate value={row.createdAt} />
      </SettingsTableCell>
      <SettingsTableCell
        label={t("settings:workspaceExports.history.columns.status")}
      >
        <ExportStatusBadge status={status} error={row.error} />
      </SettingsTableCell>
      <SettingsTableCell align="end" hideBelow="md">
        {tasks}
      </SettingsTableCell>
      <SettingsTableCell
        align="end"
        hideBelow="md"
        className="whitespace-nowrap"
      >
        {size}
      </SettingsTableCell>
      <SettingsTableCell hideBelow="lg">{expires}</SettingsTableCell>
      <SettingsTableCell kind="actions">
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
      </SettingsTableCell>
    </SettingsTableRow>
  );
}

export default ExportHistoryRow;
