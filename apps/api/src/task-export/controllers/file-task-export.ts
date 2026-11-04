import { and, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskExportTable } from "../../database/schema";
import { EXPORT_NOT_FOUND } from "../access";
import { publishExportStatus } from "../events";
import type { TaskExportRow } from "../job";
import { isDownloadable } from "../serialize";
import { deleteExportFileQuietly, openExportFile } from "../storage";

export const NOT_READY = "This export isn't ready yet";
export const EXPIRED = "This export has expired";
export const STILL_RUNNING = "This export is still running";

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii || "export"}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Streams the finished file: 409 until it is ready, 410 once expired. */
export async function downloadTaskExport(
  row: TaskExportRow,
): Promise<Response> {
  const expired =
    row.status === "expired" ||
    (row.status === "completed" && !isDownloadable(row));
  if (expired) throw new HTTPException(410, { message: EXPIRED });
  if (row.status !== "completed") {
    throw new HTTPException(409, { message: NOT_READY });
  }

  let file: Awaited<ReturnType<typeof openExportFile>>;
  try {
    file = await openExportFile(row);
  } catch (error) {
    console.error(`exports: could not read the file of ${row.id}`, error);
    file = null;
  }
  if (!file) {
    throw new HTTPException(404, { message: "Export file not found" });
  }

  const fileName = row.fileName ?? "export";
  const headers: Record<string, string> = {
    "Content-Type": row.contentType ?? "application/octet-stream",
    "Content-Disposition": contentDisposition(fileName),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const length = file.length ?? row.sizeBytes;
  if (length !== null && length !== undefined) {
    headers["Content-Length"] = String(length);
  }
  return new Response(file.body, { headers });
}

/** Deletes the export and its file; a running export answers 409. */
export async function deleteTaskExport(
  row: TaskExportRow,
): Promise<{ id: string }> {
  const [removed] = await db
    .delete(taskExportTable)
    .where(
      and(
        eq(taskExportTable.id, row.id),
        ne(taskExportTable.status, "processing"),
      ),
    )
    .returning();
  if (!removed) {
    const [current] = await db
      .select({ id: taskExportTable.id })
      .from(taskExportTable)
      .where(eq(taskExportTable.id, row.id))
      .limit(1);
    if (current) throw new HTTPException(409, { message: STILL_RUNNING });
    throw new HTTPException(404, { message: EXPORT_NOT_FOUND });
  }
  // A database-stored file went with the row.
  if (removed.objectKey) {
    await deleteExportFileQuietly(removed);
  }
  await publishExportStatus(removed, "deleted");
  return { id: removed.id };
}
