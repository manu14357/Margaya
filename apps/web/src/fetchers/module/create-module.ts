import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateModuleRequest = InferRequestType<
  (typeof client)["module"]["project"][":projectId"]["$post"]
>["json"];

async function createModule(projectId: string, json: CreateModuleRequest) {
  const response = await client.module.project[":projectId"].$post({
    param: { projectId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createModule;
