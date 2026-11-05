import { saveAs } from "file-saver";
import i18n from "i18next";
import downloadTaskExport, {
  taskExportDownloadUrl,
} from "@/fetchers/task-export/download-task-export";
import getTaskExport from "@/fetchers/task-export/get-task-export";
import { canDownload } from "@/lib/task-export/status";

/** A whole-workspace archive can reach 4 GB: too much to hold in a tab. */
const MAX_IN_MEMORY_BYTES = 256 * 1024 * 1024;

/**
 * Hands a large file to the browser's own download, which streams to disk and
 * shows progress. The session cookie authorizes the link, as with task
 * attachments, so this needs the API and web app on one site: a partitioned
 * cookie stays behind across sites. A link can't report a failure, so the
 * export is checked first.
 */
async function startBrowserDownload(id: string): Promise<string> {
  const row = await getTaskExport(id);
  if (!canDownload(row)) {
    throw new Error(i18n.t("settings:workspaceExports.toast.downloadError"));
  }
  const fileName = row.fileName ?? "export";
  const link = document.createElement("a");
  link.href = taskExportDownloadUrl(id);
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  return fileName;
}

/** Saves an export's file through the authorized route. */
export async function saveTaskExport({
  id,
  fileName,
  sizeBytes,
}: {
  id: string;
  fileName?: string | null;
  sizeBytes?: number | null;
}): Promise<string> {
  if (sizeBytes && sizeBytes > MAX_IN_MEMORY_BYTES) {
    return startBrowserDownload(id);
  }
  const file = await downloadTaskExport(id, fileName);
  saveAs(file.blob, file.fileName);
  return file.fileName;
}
