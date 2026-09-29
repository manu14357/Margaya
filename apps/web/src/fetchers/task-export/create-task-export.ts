import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { CreateTaskExportInput } from "@/types/task-export";

/** Queues a background export; the server answers with the queued row. */
async function createTaskExport(input: CreateTaskExportInput) {
  const response = await client["task-export"].$post({ json: input });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createTaskExport;
