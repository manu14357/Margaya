import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { TaskDraftPatch } from "@/types/task-draft";

/** Saves a new private draft in the workspace. */
async function createTaskDraft(workspaceId: string, fields: TaskDraftPatch) {
  const response = await client["task-draft"].$post({
    json: { ...fields, workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createTaskDraft;
