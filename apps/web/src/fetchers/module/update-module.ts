import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateModuleRequest = InferRequestType<
  (typeof client)["module"][":id"]["$put"]
>["json"];

async function updateModule(moduleId: string, json: UpdateModuleRequest) {
  const response = await client.module[":id"].$put({
    param: { id: moduleId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateModule;
