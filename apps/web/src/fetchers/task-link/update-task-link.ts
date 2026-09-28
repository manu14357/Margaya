import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function updateTaskLink({
  taskId,
  linkId,
  changes,
}: {
  taskId: string;
  linkId: string;
  /** Only the fields that changed. */
  changes: { url?: string; title?: string | null };
}) {
  const response = await client["task-link"][":taskId"][":linkId"].$patch({
    param: { taskId, linkId },
    json: changes,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateTaskLink;
