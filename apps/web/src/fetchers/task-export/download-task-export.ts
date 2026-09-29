import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import { fileNameFromDisposition } from "@/lib/task-export/file-name";

/**
 * The finished file through the authorized route (never a public URL).
 * 409 until it is ready, 410 once it has expired.
 */
async function downloadTaskExport(id: string, fallbackName?: string | null) {
  const response = await client["task-export"][":id"].download.$get({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const blob = await response.blob();
  const fileName = fileNameFromDisposition(
    response.headers.get("Content-Disposition"),
    fallbackName || "export",
  );
  return { blob, fileName };
}

export default downloadTaskExport;
