import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function removeCycleTasks(cycleId: string, taskIds: string[]) {
  const response = await client.cycle[":id"].tasks.$delete({
    param: { id: cycleId },
    json: { taskIds },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default removeCycleTasks;
