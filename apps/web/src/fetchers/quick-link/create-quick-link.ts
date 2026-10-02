import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateQuickLinkRequest = InferRequestType<
  (typeof client)["quick-link"]["$post"]
>["json"];

async function createQuickLink(request: CreateQuickLinkRequest) {
  const response = await client["quick-link"].$post({ json: request });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createQuickLink;
