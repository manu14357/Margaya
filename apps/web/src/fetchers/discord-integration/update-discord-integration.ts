import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateDiscordIntegrationRequest = InferRequestType<
  (typeof client)["discord-integration"]["project"][":projectId"]["$patch"]
>["json"];

async function updateDiscordIntegration(
  projectId: string,
  json: UpdateDiscordIntegrationRequest,
) {
  const response = await client["discord-integration"].project[
    ":projectId"
  ].$patch({
    param: { projectId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateDiscordIntegration;
