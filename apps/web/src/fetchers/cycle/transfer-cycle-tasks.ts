import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function transferCycleTasks(cycleId: string, targetCycleId: string) {
  const response = await client.cycle[":id"].transfer.$post({
    param: { id: cycleId },
    json: { targetCycleId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default transferCycleTasks;
