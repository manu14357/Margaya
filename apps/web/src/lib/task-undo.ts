import type { TFunction } from "i18next";
import unarchiveTask from "@/fetchers/task/unarchive-task";
import updateTaskStatus from "@/fetchers/task/update-task-status";
import { restoreTask } from "@/fetchers/trash/task-trash";
import { invalidateAfterArchive } from "@/hooks/mutations/task/use-archive-task";
import { invalidateAfterStatusChange } from "@/hooks/mutations/task/use-update-task-status";
import { refreshAfterTaskChange } from "@/hooks/mutations/trash/use-trash-mutations";
import { toast } from "@/lib/toast";
import queryClient from "@/query-client";

// Success toasts with an "Undo" action for single-task changes the API can
// reverse. The undo calls the same endpoints as the forward action, so the
// server publishes the usual events and activity, and it refreshes the same
// caches. It runs from the toast, after the row that started it may have
// unmounted, so it uses plain fetchers and the app's query client rather
// than component mutations.

type Deps = { t: TFunction };

function failed(t: TFunction, error: unknown, fallbackKey: string) {
  toast.error(
    error instanceof Error && error.message ? error.message : t(fallbackKey),
  );
}

/** "Moved to the trash", with Undo restoring it (and its sub-tasks). */
export function toastTaskTrashed(
  { taskId, projectId }: { taskId: string; projectId: string },
  { t }: Deps,
) {
  toast.success(t("tasks:delete.success"), {
    action: {
      label: t("common:actions.undo"),
      onClick: () => {
        void restoreTask(taskId)
          .then(() => toast.success(t("tasks:archive.restored")))
          .catch((error) => failed(t, error, "tasks:archive.restoreError"))
          .finally(() => refreshAfterTaskChange(queryClient, projectId));
      },
    },
  });
}

/** "Task archived", with Undo restoring it to its column. */
export function toastTaskArchived(
  { taskId, projectId }: { taskId: string; projectId: string },
  { t }: Deps,
) {
  toast.success(t("tasks:archive.archived"), {
    action: {
      label: t("common:actions.undo"),
      onClick: () => {
        void unarchiveTask(taskId)
          .then(() => toast.success(t("tasks:archive.restored")))
          .catch((error) => failed(t, error, "tasks:archive.restoreError"))
          .finally(() =>
            invalidateAfterArchive(queryClient, taskId, projectId),
          );
      },
    },
  });
}

/** "Task updated" after a status change, with Undo moving it back. */
export function toastTaskStatusChanged(
  {
    taskId,
    projectId,
    previousStatus,
    nextStatus,
  }: {
    taskId: string;
    projectId: string;
    previousStatus: string;
    nextStatus: string;
  },
  { t }: Deps,
) {
  if (previousStatus === nextStatus) {
    toast.success(t("tasks:update.success"));
    return;
  }
  toast.success(t("tasks:update.success"), {
    action: {
      label: t("common:actions.undo"),
      onClick: () => {
        void updateTaskStatus(taskId, { status: previousStatus })
          .catch((error) => failed(t, error, "tasks:update.error"))
          .finally(() =>
            invalidateAfterStatusChange(queryClient, {
              id: taskId,
              projectId,
            }),
          );
      },
    },
  });
}
