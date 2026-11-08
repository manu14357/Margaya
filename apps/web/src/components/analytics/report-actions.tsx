import {
  Check,
  FolderOpen,
  Lock,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Save,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDeleteAnalyticsReport,
  useUpdateAnalyticsReport,
} from "@/hooks/mutations/analytics-report/use-analytics-report-mutations";
import useToggleHomeReportPin from "@/hooks/mutations/home/use-toggle-home-report-pin";
import type { ReportNote } from "@/lib/analytics/report-config";
import { toast } from "@/lib/toast";
import type {
  AnalyticsReport,
  AnalyticsReportConfig,
} from "@/types/analytics-report";
import ReportFormDialog, { reportErrorMessage } from "./report-form-dialog";

/** Private or shared, and whose: one line under a report's name. */
function ReportMeta({ report }: { report: AnalyticsReport }) {
  const { t } = useTranslation();
  const shared = report.visibility === "workspace";
  const Icon = shared ? Users : Lock;
  return (
    <span className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">
        {shared
          ? report.isOwner || !report.owner
            ? t("analytics:reports.visibility.workspace")
            : t("analytics:reports.sharedBy", { name: report.owner.name })
          : t("analytics:reports.visibility.private")}
      </span>
    </span>
  );
}

type ReportListProps = {
  reports: AnalyticsReport[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  openedId: string | null;
  onOpen: (report: AnalyticsReport) => void;
  onEdit: (report: AnalyticsReport) => void;
  onToggleVisibility: (report: AnalyticsReport) => void;
  onDelete: (report: AnalyticsReport) => void;
  /** Pinned to the viewer's Home; empty until their Home settings load. */
  pinnedIds: readonly string[];
  canPin: boolean;
  onTogglePin: (report: AnalyticsReport) => void;
};

function ReportList({
  reports,
  isLoading,
  error,
  onRetry,
  openedId,
  onOpen,
  onEdit,
  onToggleVisibility,
  onDelete,
  pinnedIds,
  canPin,
  onTogglePin,
}: ReportListProps) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <div className="grid gap-1.5 p-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="grid justify-items-start gap-2 p-2">
        <p className="text-muted-foreground text-xs">
          {t("analytics:reports.loadError")}
        </p>
        <Button size="xs" variant="outline" onClick={onRetry}>
          {t("analytics:states.retry")}
        </Button>
      </div>
    );
  }
  if (!reports?.length) {
    return (
      <p className="p-2 text-muted-foreground text-xs">
        {t("analytics:reports.empty")}
      </p>
    );
  }
  return (
    <ul className="grid max-h-80 gap-0.5 overflow-y-auto">
      {reports.map((report) => {
        const isOpen = report.id === openedId;
        const isPinned = pinnedIds.includes(report.id);
        return (
          <li
            key={report.id}
            className="flex items-center gap-1 rounded-md hover:bg-accent/50"
          >
            <button
              type="button"
              aria-current={isOpen || undefined}
              onClick={() => onOpen(report)}
              className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium text-sm">
                  {report.name}
                </span>
                <ReportMeta report={report} />
              </span>
              {isOpen && (
                <Check
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              )}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="mr-1 shrink-0"
                    aria-label={t("analytics:reports.actionsFor", {
                      name: report.name,
                    })}
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  disabled={!canPin}
                  onClick={() => onTogglePin(report)}
                >
                  {isPinned ? <PinOff /> : <Pin />}
                  {isPinned
                    ? t("analytics:reports.unpin")
                    : t("analytics:reports.pin")}
                </DropdownMenuItem>
                {report.isOwner && (
                  <>
                    <DropdownMenuItem onClick={() => onEdit(report)}>
                      <Pencil />
                      {t("analytics:reports.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onToggleVisibility(report)}
                    >
                      {report.visibility === "private" ? <Users /> : <Lock />}
                      {report.visibility === "private"
                        ? t("analytics:reports.share")
                        : t("analytics:reports.makePrivate")}
                    </DropdownMenuItem>
                  </>
                )}
                {report.canDelete && <DropdownMenuSeparator />}
                {report.canDelete && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onDelete(report)}
                  >
                    <Trash2 />
                    {t("analytics:reports.delete")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        );
      })}
    </ul>
  );
}

type ReportActionsProps = {
  workspaceId: string;
  reports: AnalyticsReport[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** The report on screen, if one was opened or saved. */
  opened: AnalyticsReport | null;
  /** The builder or task set differs from the opened report. */
  isDirty: boolean;
  /** The configuration on screen, for Save and Update. */
  currentConfig: AnalyticsReportConfig;
  onOpen: (report: AnalyticsReport) => void;
  /** A new report was saved from the screen: it is now the opened one. */
  onSaved: (report: AnalyticsReport) => void;
};

/** "Reports" (open, rename, share, delete) and Save / Update on the builder. */
export default function ReportActions({
  workspaceId,
  reports,
  isLoading,
  error,
  onRetry,
  opened,
  isDirty,
  currentConfig,
  onOpen,
  onSaved,
}: ReportActionsProps) {
  const { t } = useTranslation();
  const [listOpen, setListOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AnalyticsReport | null>(null);
  const [deleting, setDeleting] = useState<AnalyticsReport | null>(null);
  const updateReport = useUpdateAnalyticsReport();
  const deleteReport = useDeleteAnalyticsReport();
  const pins = useToggleHomeReportPin(workspaceId);

  const showError = (reason: Error, fallback: string) =>
    toast.error(reportErrorMessage(reason) ?? fallback);

  const handleUpdate = () => {
    if (!opened) return;
    updateReport.mutate(
      { id: opened.id, changes: { config: currentConfig } },
      {
        onSuccess: () => toast.success(t("analytics:reports.toast.updated")),
        onError: (reason) =>
          showError(reason, t("analytics:reports.toast.saveError")),
      },
    );
  };

  const handleToggleVisibility = (report: AnalyticsReport) => {
    const visibility =
      report.visibility === "private" ? "workspace" : "private";
    updateReport.mutate(
      { id: report.id, changes: { visibility } },
      {
        onSuccess: () =>
          toast.success(
            visibility === "workspace"
              ? t("analytics:reports.toast.shared")
              : t("analytics:reports.toast.madePrivate"),
          ),
        onError: (reason) =>
          showError(reason, t("analytics:reports.toast.saveError")),
      },
    );
  };

  const handleDelete = () => {
    if (!deleting) return;
    deleteReport.mutate(
      { id: deleting.id, workspaceId },
      {
        onSuccess: () => {
          toast.success(t("analytics:reports.toast.deleted"));
          setDeleting(null);
        },
        onError: (reason) =>
          showError(reason, t("analytics:reports.toast.deleteError")),
      },
    );
  };

  const canUpdate = Boolean(opened?.isOwner && isDirty);

  return (
    <>
      <Popover open={listOpen} onOpenChange={setListOpen}>
        <PopoverTrigger
          render={<Button variant="outline" size="xs" className="gap-1" />}
        >
          <FolderOpen className="size-3.5" />
          {t("analytics:reports.open")}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1">
          <p className="px-2 pt-1 pb-1.5 font-medium text-muted-foreground text-xs">
            {t("analytics:reports.listTitle")}
          </p>
          <ReportList
            reports={reports}
            isLoading={isLoading}
            error={error}
            onRetry={onRetry}
            openedId={opened?.id ?? null}
            onOpen={(report) => {
              setListOpen(false);
              onOpen(report);
            }}
            onEdit={(report) => {
              setListOpen(false);
              setEditing(report);
            }}
            onToggleVisibility={handleToggleVisibility}
            onDelete={(report) => {
              setListOpen(false);
              setDeleting(report);
            }}
            pinnedIds={pins.pinnedIds}
            canPin={pins.isReady}
            onTogglePin={(report) =>
              pins.toggle(
                report.id,
                (reports ?? []).map((entry) => entry.id),
              )
            }
          />
        </PopoverContent>
      </Popover>
      {canUpdate && (
        <Button
          variant="outline"
          size="xs"
          loading={updateReport.isPending}
          onClick={handleUpdate}
        >
          {t("analytics:reports.update")}
        </Button>
      )}
      <Button
        variant="outline"
        size="xs"
        className="gap-1"
        onClick={() => setCreating(true)}
      >
        <Save className="size-3.5" />
        {opened
          ? t("analytics:reports.saveAsNew")
          : t("analytics:reports.save")}
      </Button>

      <ReportFormDialog
        open={creating}
        onOpenChange={setCreating}
        workspaceId={workspaceId}
        config={currentConfig}
        onSaved={onSaved}
      />
      <ReportFormDialog
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        workspaceId={workspaceId}
        report={editing ?? undefined}
      />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next && !deleteReport.isPending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("analytics:reports.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.visibility === "workspace"
                ? t("analytics:reports.deleteSharedDescription", {
                    name: deleting?.name ?? "",
                  })
                : t("analytics:reports.deleteDescription", {
                    name: deleting?.name ?? "",
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={deleteReport.isPending}
              onClick={() => setDeleting(null)}
            >
              {t("analytics:reports.dialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={deleteReport.isPending}
              onClick={handleDelete}
            >
              {t("analytics:reports.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The opened report's name, its unsaved state and what wasn't applied. */
export function ReportStatus({
  report,
  isDirty,
  notes,
  onClose,
}: {
  report: AnalyticsReport;
  isDirty: boolean;
  notes: readonly ReportNote[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const noteText = (note: ReportNote) => {
    switch (note.kind) {
      case "dropped":
        return t("analytics:reports.notes.dropped", { count: note.count });
      case "leftOut":
        return t("analytics:reports.notes.leftOut", { count: note.count });
      case "allProjects":
        return t("analytics:reports.notes.allProjects");
      case "otherProjects":
        return t("analytics:reports.notes.otherProjects");
      case "builderReset":
        return t("analytics:reports.notes.builderReset");
    }
  };
  return (
    <div role="status" className="grid basis-full gap-1 text-xs">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-muted-foreground">
          {t("analytics:reports.showing", { name: report.name })}
        </span>
        {isDirty && (
          <span className="shrink-0 text-muted-foreground">
            · {t("analytics:reports.unsaved")}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          aria-label={t("analytics:reports.close")}
          title={t("analytics:reports.close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {notes.length > 0 && (
        <ul className="grid gap-0.5 text-muted-foreground">
          {notes.map((note) => (
            <li key={note.kind}>{noteText(note)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
