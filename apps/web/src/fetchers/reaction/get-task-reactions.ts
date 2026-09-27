import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** The task's reactions and every comment's, in one request. */
async function getTaskReactions(taskId: string) {
  const response = await client.reaction.task[":taskId"].$get({
    param: { taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getTaskReactions;
