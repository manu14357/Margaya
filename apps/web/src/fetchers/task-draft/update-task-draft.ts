import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { TaskDraftPatch } from "@/types/task-draft";

/** Changes some fields of one of the caller's drafts. */
async function updateTaskDraft(id: string, fields: TaskDraftPatch) {
  const response = await client["task-draft"][":id"].$patch({
    param: { id },
    json: fields,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateTaskDraft;
