import type { QueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import getTaskExport from "@/fetchers/task-export/get-task-export";
import { taskExportQueryKeys } from "@/hooks/queries/task-export/task-export-query-keys";
import { saveTaskExport } from "@/lib/task-export/download";
import { toast } from "@/lib/toast";

// EXPORT_UPDATED arrives on the requester's user socket for every status
// change. Each one refreshes the history; a finished or failed export also
// gets one toast per tab, wherever the requester is in the app.

type ExportMessage = {
  type?: string;
  workspaceId?: string | null;
  exportId?: string | null;
  status?: string | null;
};

export type ExportNotifier = {
  ready: (exportId: string) => void;
  failed: (exportId: string) => void;
};

/** Returns a handler that reports whether it handled the message type. */
export function createTaskExportMessageHandler(notify: ExportNotifier) {
  // A reconnect or a duplicate broadcast must not toast twice.
  const notified = new Set<string>();

  return (
    queryClient: Pick<QueryClient, "invalidateQueries">,
    message: ExportMessage,
  ): boolean => {
    if (message.type !== "EXPORT_UPDATED") return false;
    void queryClient.invalidateQueries({
      queryKey: message.workspaceId
        ? taskExportQueryKeys.workspace(message.workspaceId)
        : taskExportQueryKeys.all(),
    });
    const { exportId, status } = message;
    if (!exportId) return true;
    void queryClient.invalidateQueries({
      queryKey: taskExportQueryKeys.detail(exportId),
    });
    if (status !== "completed" && status !== "failed") return true;
    if (notified.has(exportId)) return true;
    notified.add(exportId);
    if (status === "completed") notify.ready(exportId);
    else notify.failed(exportId);
    return true;
  };
}

async function loadExport(exportId: string) {
  try {
    return await getTaskExport(exportId);
  } catch {
    return null;
  }
}

function errorText(error: unknown, fallbackKey: string) {
  return error instanceof Error && error.message
    ? error.message
    : i18n.t(fallbackKey);
}

const toastNotifier: ExportNotifier = {
  ready: (exportId) => {
    void loadExport(exportId).then((row) => {
      // Deleted in the meantime: nothing left to download.
      if (!row) return;
      toast.success(i18n.t("settings:workspaceExports.toast.ready"), {
        description: row.fileName ?? undefined,
        action: {
          label: i18n.t("settings:workspaceExports.toast.download"),
          onClick: () => {
            saveTaskExport({
              id: exportId,
              fileName: row.fileName,
              sizeBytes: row.sizeBytes,
            }).catch((error: unknown) =>
              toast.error(
                errorText(
                  error,
                  "settings:workspaceExports.toast.downloadError",
                ),
              ),
            );
          },
        },
      });
    });
  },
  failed: (exportId) => {
    void loadExport(exportId).then((row) => {
      toast.error(
        i18n.t("settings:workspaceExports.toast.failed", {
          reason:
            row?.error ||
            i18n.t("settings:workspaceExports.toast.failedUnknown"),
        }),
      );
    });
  },
};

export const handleTaskExportUserMessage =
  createTaskExportMessageHandler(toastNotifier);
