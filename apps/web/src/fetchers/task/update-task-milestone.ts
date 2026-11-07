import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function updateTaskMilestone(taskId: string, isMilestone: boolean) {
  const response = await client.task.milestone[":id"].$put({
    param: { id: taskId },
    json: { isMilestone },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateTaskMilestone;
