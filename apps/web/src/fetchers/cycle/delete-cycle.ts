import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteCycle(cycleId: string) {
  const response = await client.cycle[":id"].$delete({
    param: { id: cycleId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteCycle;
