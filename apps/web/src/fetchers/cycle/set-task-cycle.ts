import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function setTaskCycle(taskId: string, cycleId: string | null) {
  const response = await client.cycle.task[":taskId"].$put({
    param: { taskId },
    json: { cycleId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default setTaskCycle;
