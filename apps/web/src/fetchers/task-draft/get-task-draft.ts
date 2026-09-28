import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** One of the caller's drafts, with its description. */
async function getTaskDraft(id: string) {
  const response = await client["task-draft"][":id"].$get({ param: { id } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getTaskDraft;
