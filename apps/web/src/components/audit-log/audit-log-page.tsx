import { Download, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPage } from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Frame, FramePanel } from "@/components/ui/frame";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useExportAuditLog } from "@/hooks/mutations/audit-log/use-export-audit-log";
import { useAuditLog } from "@/hooks/queries/audit-log/use-audit-log";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { DEFAULT_AUDIT_LOG_FILTERS, isFiltered } from "@/lib/audit-log/filters";
import { toast } from "@/lib/toast";
import type { AuditLogFilters } from "@/types/audit-log";
import { AuditLogFiltersBar } from "./audit-log-filters";
import { AuditLogRow } from "./audit-log-row";

/** Settings → Workspace → Audit log (audit_log:read). */
export function AuditLogPage() {
  const { t } = useTranslation();
  const { workspace, canReadAuditLog, isCheckingPermissions } =
    useWorkspacePermission();
  const workspaceId = workspace?.id;
  const allowed = !isCheckingPermissions && canReadAuditLog();
  const denied = !isCheckingPermissions && !allowed;
  const [filters, setFilters] = useState<AuditLogFilters>(
    DEFAULT_AUDIT_LOG_FILTERS,
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const log = useAuditLog(workspaceId, filters, { enabled: allowed });
  const exportCsv = useExportAuditLog();
  const rows = useMemo(
    () => log.data?.pages.flatMap((page) => page.items) ?? [],
    [log.data],
  );
  const retentionDays = log.data?.pages[0]?.retentionDays;

  const handleExport = () => {
    if (!workspaceId) return;
    exportCsv.mutate(
      { workspaceId, filters },
      {
        onError: () => toast.error(t("settings:workspaceAuditLog.exportError")),
      },
    );
  };

  let body: React.ReactNode;
  if (log.isLoading) {
    body = (
      <Frame>
        <FramePanel className="space-y-3 p-4">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </FramePanel>
      </Frame>
    );
  } else if (log.isError) {
    body = (
      <Frame>
        <FramePanel className="flex items-center justify-between gap-3 p-4 text-sm">
          <span className="text-destructive-foreground">
            {t("settings:workspaceAuditLog.loadError")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void log.refetch()}
          >
            {t("settings:workspaceAuditLog.retry")}
          </Button>
        </FramePanel>
      </Frame>
    );
  } else if (rows.length === 0) {
    body = isFiltered(filters) ? (
      <Frame>
        <FramePanel className="p-8 text-center text-muted-foreground text-sm">
          {t("settings:workspaceAuditLog.noMatch")}
        </FramePanel>
      </Frame>
    ) : (
      <Empty className="rounded-lg border border-dashed py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ScrollText />
          </EmptyMedia>
          <EmptyTitle>{t("settings:workspaceAuditLog.empty.title")}</EmptyTitle>
          <EmptyDescription>
            {t("settings:workspaceAuditLog.empty.description")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    body = (
      <div className="space-y-3">
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("settings:workspaceAuditLog.columns.time")}
                </TableHead>
                <TableHead>
                  {t("settings:workspaceAuditLog.columns.actor")}
                </TableHead>
                <TableHead>
                  {t("settings:workspaceAuditLog.columns.action")}
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  {t("settings:workspaceAuditLog.columns.target")}
                </TableHead>
                <TableHead>
                  <span className="sr-only">
                    {t("settings:workspaceAuditLog.columns.details")}
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((entry) => (
                <AuditLogRow
                  key={entry.id}
                  entry={entry}
                  expanded={expandedId === entry.id}
                  onToggle={() =>
                    setExpandedId((current) =>
                      current === entry.id ? null : entry.id,
                    )
                  }
                />
              ))}
            </TableBody>
          </Table>
        </Frame>
        {log.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void log.fetchNextPage()}
              disabled={log.isFetchingNextPage}
            >
              {log.isFetchingNextPage && <Spinner className="size-4" />}
              {t("settings:workspaceAuditLog.loadMore")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <SettingsPage
      title={t("settings:workspaceAuditLog.title")}
      documentTitle={t("settings:workspaceAuditLog.pageTitle")}
      width="wide"
      description={
        denied
          ? t("settings:workspaceAuditLog.noPermission")
          : retentionDays === 0
            ? t("settings:workspaceAuditLog.subtitleForever")
            : t("settings:workspaceAuditLog.subtitle", {
                days: retentionDays ?? 365,
              })
      }
      actions={
        allowed ? (
          <Button
            size="sm"
            variant="outline"
            onClick={handleExport}
            disabled={!workspaceId || exportCsv.isPending}
          >
            {exportCsv.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <Download />
            )}
            {t("settings:workspaceAuditLog.exportCsv")}
          </Button>
        ) : undefined
      }
    >
      {allowed && workspaceId && (
        <div className="space-y-3">
          <AuditLogFiltersBar
            workspaceId={workspaceId}
            filters={filters}
            onChange={(next) => {
              setExpandedId(null);
              setFilters(next);
            }}
          />
          {body}
        </div>
      )}
    </SettingsPage>
  );
}

export default AuditLogPage;
