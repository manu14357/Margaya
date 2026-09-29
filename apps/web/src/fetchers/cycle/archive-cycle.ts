import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

export async function archiveCycle(cycleId: string) {
  const response = await client.cycle[":id"].archive.$post({
    param: { id: cycleId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export async function unarchiveCycle(cycleId: string) {
  const response = await client.cycle[":id"].unarchive.$post({
    param: { id: cycleId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}
