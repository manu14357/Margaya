import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import type { SlackAppState } from "./get-slack-app";

export type UpdateSlackAppRequest = InferRequestType<
  (typeof client)["slack-app"]["workspace"][":workspaceId"]["$patch"]
>["json"];

async function updateSlackApp(
  workspaceId: string,
  json: UpdateSlackAppRequest,
): Promise<SlackAppState> {
  const response = await client["slack-app"].workspace[":workspaceId"].$patch({
    param: { workspaceId },
    json,
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default updateSlackApp;
