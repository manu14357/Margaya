import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type SlackLinkPreview = InferResponseType<
  (typeof client)["slack-app"]["links"]["preview"]["$post"],
  200
>;

async function previewSlackLink(token: string): Promise<SlackLinkPreview> {
  const response = await client["slack-app"].links.preview.$post({
    json: { token },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default previewSlackLink;
