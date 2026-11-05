import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { CreateWorkspaceExportInput } from "@/types/task-export";

/** Queues a whole-workspace export; answers with the queued row. */
async function createWorkspaceExport(input: CreateWorkspaceExportInput) {
  const response = await client["task-export"].workspace.$post({ json: input });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createWorkspaceExport;
