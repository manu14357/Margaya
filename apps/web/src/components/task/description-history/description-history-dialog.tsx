import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDescriptionVersions } from "@/hooks/queries/task-description-version/use-description-versions";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import DescriptionVersionList from "./description-version-list";
import DescriptionVersionPreview from "./description-version-preview";

type DescriptionHistoryDialogProps = {
  taskId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The description's saved versions: the list, the selected version
 * read-only, and Restore for people who can edit the task.
 */
export default function DescriptionHistoryDialog({
  taskId,
  projectId,
  open,
  onOpenChange,
}: DescriptionHistoryDialogProps) {
  const { t } = useTranslation();
  const versions = useDescriptionVersions(taskId, open);
  const { canUpdateTasks } = useWorkspacePermission();
  const [picked, setPicked] = useState<string | undefined>();
  const list = versions.data ?? [];
  const selectedId =
    picked && list.some((version) => version.id === picked)
      ? picked
      : list[0]?.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("tasks:descriptionHistory.title")}</DialogTitle>
          <DialogDescription>
            {t("tasks:descriptionHistory.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 px-6 pb-6 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="max-h-[30vh] min-h-0 overflow-y-auto md:max-h-[60vh]">
            {versions.isError ? (
              <div className="flex flex-col items-start gap-2 px-2.5 py-3">
                <p className="text-muted-foreground text-sm">
                  {t("tasks:descriptionHistory.loadError")}
                </p>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => void versions.refetch()}
                >
                  {t("tasks:descriptionHistory.retry")}
                </Button>
              </div>
            ) : (
              <DescriptionVersionList
                versions={list}
                isLoading={versions.isLoading}
                selectedId={selectedId}
                onSelect={setPicked}
              />
            )}
          </div>
          <div className="max-h-[60vh] min-h-0 overflow-y-auto">
            {selectedId && (
              <DescriptionVersionPreview
                taskId={taskId}
                projectId={projectId}
                versionId={selectedId}
                isLatest={selectedId === list[0]?.id}
                canRestore={Boolean(canUpdateTasks())}
                onRestored={() => {
                  setPicked(undefined);
                  onOpenChange(false);
                }}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
