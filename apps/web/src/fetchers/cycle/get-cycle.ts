import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getCycle(cycleId: string) {
  const response = await client.cycle[":id"].$get({ param: { id: cycleId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getCycle;
