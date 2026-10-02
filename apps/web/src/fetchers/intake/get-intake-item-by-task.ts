import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getIntakeItemByTask(taskId: string) {
  const response = await client.intake.task[":taskId"].$get({
    param: { taskId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getIntakeItemByTask;
