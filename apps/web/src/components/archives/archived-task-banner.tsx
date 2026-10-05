import { useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useArchiveTask } from "@/hooks/mutations/task/use-archive-task";
import { archiveQueryKeys } from "@/hooks/queries/archive/archive-query-keys";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";

type ArchivedTaskBannerProps = {
  task:
    | { id: string; projectId: string; archivedAt?: string | null }
    | null
    | undefined;
};

/** Above an archived task's title: when it was archived, and Restore. */
export default function ArchivedTaskBanner({ task }: ArchivedTaskBannerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canUpdateTasks, isCheckingPermissions } = useWorkspacePermission();
  const archiveTask = useArchiveTask();

  if (!task?.archivedAt) return null;
  const canRestore = !isCheckingPermissions && canUpdateTasks();

  const restore = () =>
    archiveTask.mutate(
      { taskId: task.id, projectId: task.projectId, archived: false },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: archiveQueryKeys.all(),
          });
          toast.success(t("workspace:archives.toast.taskRestored"));
        },
        onError: () => toast.error(t("tasks:archive.restoreError")),
      },
    );

  return (
    <Alert>
      <Archive />
      <AlertTitle className="font-normal text-muted-foreground">
        {t("tasks:archivedBanner.message", {
          time: formatRelativeTime(task.archivedAt),
        })}
      </AlertTitle>
      {canRestore && (
        <AlertAction>
          <Button
            variant="outline"
            size="xs"
            loading={archiveTask.isPending}
            onClick={restore}
          >
            {t("tasks:archivedBanner.restore")}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
