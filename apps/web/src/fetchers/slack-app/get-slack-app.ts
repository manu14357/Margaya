import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type SlackAppState = InferResponseType<
  (typeof client)["slack-app"]["workspace"][":workspaceId"]["$get"],
  200
>;

async function getSlackApp(workspaceId: string): Promise<SlackAppState> {
  const response = await client["slack-app"].workspace[":workspaceId"].$get({
    param: { workspaceId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default getSlackApp;
