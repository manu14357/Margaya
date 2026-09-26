import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
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
import { useRestoreDescriptionVersion } from "@/hooks/mutations/task-description-version/use-restore-description-version";
import { useDescriptionVersion } from "@/hooks/queries/task-description-version/use-description-version";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";

type DescriptionVersionPreviewProps = {
  taskId: string;
  projectId: string;
  versionId: string;
  /** The newest version is the description as it is now. */
  isLatest: boolean;
  canRestore: boolean;
  onRestored: () => void;
};

/** A saved version, read-only, with Restore (after a confirm). */
export default function DescriptionVersionPreview({
  taskId,
  projectId,
  versionId,
  isLatest,
  canRestore,
  onRestored,
}: DescriptionVersionPreviewProps) {
  const { t } = useTranslation();
  const version = useDescriptionVersion(taskId, versionId);
  const restore = useRestoreDescriptionVersion();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleRestore = () => {
    restore.mutate(
      { taskId, projectId, versionId },
      {
        onSuccess: () => {
          toast.success(t("tasks:descriptionHistory.restored"));
          setConfirmOpen(false);
          onRestored();
        },
        onError: (error) =>
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : t("tasks:descriptionHistory.restoreError"),
          ),
      },
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center gap-2 border-border/80 border-b pb-2">
        <span className="min-w-0 truncate font-medium text-sm">
          {version.data
            ? t("tasks:descriptionHistory.previewTitle", {
                date: formatDateTime(version.data.savedAt),
              })
            : null}
        </span>
        <Badge variant="outline">
          {t("tasks:descriptionHistory.viewOnly")}
        </Badge>
        {canRestore && !isLatest && (
          <Button
            size="xs"
            className="ms-auto"
            disabled={!version.data}
            onClick={() => setConfirmOpen(true)}
          >
            {t("tasks:descriptionHistory.restore")}
          </Button>
        )}
      </div>

      {version.isLoading ? (
        <div className="space-y-2">
          {["a", "b", "c", "d"].map((key) => (
            <Skeleton key={key} className="h-4 w-full" />
          ))}
        </div>
      ) : version.isError || !version.data ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-muted-foreground text-sm">
            {t("tasks:descriptionHistory.loadError")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void version.refetch()}
          >
            {t("tasks:descriptionHistory.retry")}
          </Button>
        </div>
      ) : version.data.content.trim() ? (
        <MarkdownRenderer
          key={version.data.id}
          content={version.data.content}
        />
      ) : (
        <p className="text-muted-foreground text-sm italic">
          {t("tasks:descriptionHistory.emptyVersion")}
        </p>
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(next) => !restore.isPending && setConfirmOpen(next)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tasks:descriptionHistory.restoreConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks:descriptionHistory.restoreConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={restore.isPending}
              onClick={() => setConfirmOpen(false)}
            >
              {t("tasks:descriptionHistory.cancel")}
            </Button>
            <Button loading={restore.isPending} onClick={handleRestore}>
              {t("tasks:descriptionHistory.restore")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
