import { saveAs } from "file-saver";
import downloadTaskExport from "@/fetchers/task-export/download-task-export";

/** Fetches an export's file through the typed client and saves it. */
export async function saveTaskExport({
  id,
  fileName,
}: {
  id: string;
  fileName?: string | null;
}): Promise<string> {
  const file = await downloadTaskExport(id, fileName);
  saveAs(file.blob, file.fileName);
  return file.fileName;
}
