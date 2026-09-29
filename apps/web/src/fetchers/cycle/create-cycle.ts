import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateCycleRequest = InferRequestType<
  (typeof client)["cycle"]["project"][":projectId"]["$post"]
>["json"];

async function createCycle(projectId: string, json: CreateCycleRequest) {
  const response = await client.cycle.project[":projectId"].$post({
    param: { projectId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createCycle;
