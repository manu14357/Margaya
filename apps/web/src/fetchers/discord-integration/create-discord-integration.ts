import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateDiscordIntegrationRequest = InferRequestType<
  (typeof client)["discord-integration"]["project"][":projectId"]["$post"]
>["json"];

async function createDiscordIntegration(
  projectId: string,
  json: CreateDiscordIntegrationRequest,
) {
  const response = await client["discord-integration"].project[
    ":projectId"
  ].$post({
    param: { projectId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createDiscordIntegration;
