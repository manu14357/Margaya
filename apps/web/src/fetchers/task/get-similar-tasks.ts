import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Open tasks of the project whose titles look like `q` (duplicate hints). */
export async function getSimilarTasks(
  projectId: string,
  q: string,
  signal?: AbortSignal,
) {
  const response = await client.task.similar[":projectId"].$get(
    { param: { projectId }, query: { q } },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to find similar tasks");
  }
  return response.json();
}
