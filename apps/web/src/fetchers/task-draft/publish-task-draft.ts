import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { TaskDraftPatch } from "@/types/task-draft";

/**
 * Turns a draft into a task. The optional patch is saved to the draft first
 * and kept even when publishing is refused.
 */
async function publishTaskDraft(id: string, patch: TaskDraftPatch = {}) {
  const response = await client["task-draft"][":id"].publish.$post({
    param: { id },
    json: patch,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default publishTaskDraft;
