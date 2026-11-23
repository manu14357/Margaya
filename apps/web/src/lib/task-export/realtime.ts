import type { QueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import getTaskExport from "@/fetchers/task-export/get-task-export";
import { taskExportQueryKeys } from "@/hooks/queries/task-export/task-export-query-keys";
import { saveTaskExport } from "@/lib/task-export/download";
import { toast } from "@/lib/toast";

// EXPORT_UPDATED arrives on the requester's user socket for every status
// change, in every session they have open. Each one refreshes the history;
// a finished or failed export also gets one toast, only in the tab that
// started it (wherever the requester is in the app by then). Other tabs and
// devices see the row change in the exports list without a toast.

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

// The exports this tab started. sessionStorage is per tab and survives a
// reload, so a reload while the export runs still gets its toast.
const STARTED_STORAGE_KEY = "margaya:task-exports-started";

function readStarted(): string[] {
  try {
    const raw = window.sessionStorage.getItem(STARTED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

const startedHere = new Set<string>(
  typeof window === "undefined" ? [] : readStarted(),
);

function writeStarted() {
  try {
    window.sessionStorage.setItem(
      STARTED_STORAGE_KEY,
      // Only the newest few matter; a forgotten one just goes untoasted.
      JSON.stringify([...startedHere].slice(-20)),
    );
  } catch {
    // Storage unavailable: the in-memory set still covers this page load.
  }
}

// A tiny export can finish before this tab has read the create response:
// its ending waits here until the create mutation claims it.
const finishedEarly = new Map<string, "completed" | "failed">();

/** Called by the create mutations: this tab toasts when it finishes. */
export function rememberStartedExport(exportId: string) {
  const early = finishedEarly.get(exportId);
  if (early) {
    finishedEarly.delete(exportId);
    if (early === "completed") toastNotifier.ready(exportId);
    else toastNotifier.failed(exportId);
    return;
  }
  startedHere.add(exportId);
  writeStarted();
}

function claimStartedExport(exportId: string, status: "completed" | "failed") {
  if (!startedHere.delete(exportId)) {
    finishedEarly.set(exportId, status);
    // Only the newest few could still be claimed.
    for (const id of finishedEarly.keys()) {
      if (finishedEarly.size <= 20) break;
      finishedEarly.delete(id);
    }
    return false;
  }
  writeStarted();
  return true;
}

/** Returns a handler that reports whether it handled the message type. */
export function createTaskExportMessageHandler(
  notify: ExportNotifier,
  /** Whether this tab should toast for the export; every one by default. */
  startedInThisTab: (
    exportId: string,
    status: "completed" | "failed",
  ) => boolean = () => true,
) {
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
    if (!startedInThisTab(exportId, status)) return true;
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

export const handleTaskExportUserMessage = createTaskExportMessageHandler(
  toastNotifier,
  claimStartedExport,
);
