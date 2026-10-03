import { ArrowLeft, History } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRestorePageVersion } from "@/hooks/mutations/page/use-restore-page-version";
import { useGetPageVersion } from "@/hooks/queries/page/use-get-page-version";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import type { Page } from "@/types/page";
import PageEditor from "./page-editor/page-editor";

type PageVersionPreviewProps = {
  page: Page;
  workspaceId: string;
  versionId: string;
  onClose: () => void;
};

/**
 * A saved version, read-only, in the page canvas: a sticky bar across the
 * canvas ("Back to current", the version, Restore), then the version at
 * reading width.
 */
export default function PageVersionPreview({
  page,
  workspaceId,
  versionId,
  onClose,
}: PageVersionPreviewProps) {
  const { t } = useTranslation();
  const version = useGetPageVersion(page.id, versionId);
  const restore = useRestorePageVersion();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const canRestore = page.capabilities.canRestoreVersion;

  const handleRestore = () => {
    if (!page.projectId) return;
    restore.mutate(
      { pageId: page.id, projectId: page.projectId, versionId },
      {
        onSuccess: () => {
          toast.success(t("pages:history.restored"));
          setConfirmOpen(false);
          onClose();
        },
        onError: (error) =>
          toast.error(
            pageErrorMessage(error) ?? t("pages:history.restoreError"),
          ),
      },
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex min-h-10 flex-wrap items-center gap-2 border-border/80 border-b bg-[color-mix(in_srgb,var(--info)_8%,var(--background))] px-2 py-1.5 md:px-3 dark:bg-[color-mix(in_srgb,var(--info)_16%,var(--background))]">
        <Button variant="ghost" size="xs" className="gap-1" onClick={onClose}>
          <ArrowLeft className="size-3.5" />
          {t("pages:history.backToCurrent")}
        </Button>
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-[13px]">
          <History className="size-3.5 shrink-0 text-info-foreground" />
          <span className="truncate">
            {version.data
              ? t("pages:history.previewTitle", {
                  date: formatDateTime(version.data.lastSavedAt),
                })
              : null}
          </span>
        </span>
        <Badge variant="outline">{t("pages:history.viewOnly")}</Badge>
        {canRestore && (
          <Button
            size="xs"
            className="ms-auto"
            disabled={!version.data}
            onClick={() => setConfirmOpen(true)}
          >
            {t("pages:history.restore")}
          </Button>
        )}
      </div>
      <div
        className={cn(
          "mx-auto w-full px-4 pt-6 pb-24 sm:px-10 md:pt-10",
          page.isFullWidth ? "max-w-6xl" : "max-w-3xl",
        )}
      >
        {version.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-2/3" />
            {Array.from({ length: 6 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        ) : version.isError || !version.data ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-muted-foreground text-sm">
              {t("pages:history.loadError")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void version.refetch()}
            >
              {t("pages:history.retry")}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <h1 className="font-bold text-[2rem] leading-tight tracking-tight">
              {version.data.title.trim() || t("pages:list.untitled")}
            </h1>
            <PageEditor
              key={version.data.id}
              pageId={page.id}
              workspaceId={workspaceId}
              projectId={page.projectId ?? ""}
              editable={false}
              content={{ type: "json", value: version.data.contentJson }}
            />
          </div>
        )}
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(next) => !restore.isPending && setConfirmOpen(next)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages:history.restoreConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages:history.restoreConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={restore.isPending}
              onClick={() => setConfirmOpen(false)}
            >
              {t("pages:history.restoreCancel")}
            </Button>
            <Button loading={restore.isPending} onClick={handleRestore}>
              {restore.isPending
                ? t("pages:history.restoring")
                : t("pages:history.restore")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
