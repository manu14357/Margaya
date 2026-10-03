import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdatePageRequest = InferRequestType<
  (typeof client)["page"][":id"]["$patch"]
>["json"];

/** Title, logo or full width. */
async function updatePage(pageId: string, json: UpdatePageRequest) {
  const response = await client.page[":id"].$patch({
    param: { id: pageId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updatePage;
