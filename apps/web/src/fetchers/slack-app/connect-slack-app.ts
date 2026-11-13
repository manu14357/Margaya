import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import type { SlackAppState } from "./get-slack-app";

export type ConnectSlackAppRequest = InferRequestType<
  (typeof client)["slack-app"]["workspace"][":workspaceId"]["$post"]
>["json"];

async function connectSlackApp(
  workspaceId: string,
  json: ConnectSlackAppRequest,
): Promise<SlackAppState> {
  const response = await client["slack-app"].workspace[":workspaceId"].$post({
    param: { workspaceId },
    json,
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default connectSlackApp;
