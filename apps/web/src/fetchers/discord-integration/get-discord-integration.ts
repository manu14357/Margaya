import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type DiscordIntegration = InferResponseType<
  (typeof client)["discord-integration"]["project"][":projectId"]["$get"],
  200
>;

async function getDiscordIntegration(projectId: string) {
  const response = await client["discord-integration"].project[
    ":projectId"
  ].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getDiscordIntegration;
