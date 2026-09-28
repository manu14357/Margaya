import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Deletes one of the caller's drafts for good. */
async function deleteTaskDraft(id: string) {
  const response = await client["task-draft"][":id"].$delete({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteTaskDraft;
