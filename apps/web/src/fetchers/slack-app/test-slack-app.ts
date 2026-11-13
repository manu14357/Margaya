import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type SlackAppTestResult = InferResponseType<
  (typeof client)["slack-app"]["workspace"][":workspaceId"]["test"]["$post"],
  200
>;

async function testSlackApp(workspaceId: string): Promise<SlackAppTestResult> {
  const response = await client["slack-app"].workspace[
    ":workspaceId"
  ].test.$post({ param: { workspaceId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default testSlackApp;
