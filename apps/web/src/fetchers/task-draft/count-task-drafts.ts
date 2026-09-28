import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** How many drafts the caller has in a workspace. */
async function countTaskDrafts(workspaceId: string) {
  const response = await client["task-draft"].count.$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default countTaskDrafts;
