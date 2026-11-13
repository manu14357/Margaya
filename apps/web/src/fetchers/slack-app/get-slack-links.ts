import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type SlackLink = InferResponseType<
  (typeof client)["slack-app"]["links"]["$get"],
  200
>[number];

async function getSlackLinks(): Promise<SlackLink[]> {
  const response = await client["slack-app"].links.$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default getSlackLinks;
