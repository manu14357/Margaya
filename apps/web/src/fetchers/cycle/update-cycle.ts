import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateCycleRequest = InferRequestType<
  (typeof client)["cycle"][":id"]["$put"]
>["json"];

async function updateCycle(cycleId: string, json: UpdateCycleRequest) {
  const response = await client.cycle[":id"].$put({
    param: { id: cycleId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateCycle;
