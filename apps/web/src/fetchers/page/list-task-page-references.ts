import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Visible pages that link to a task. */
async function listTaskPageReferences(taskId: string) {
  const response = await client.page.task[":taskId"].references.$get({
    param: { taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listTaskPageReferences;
