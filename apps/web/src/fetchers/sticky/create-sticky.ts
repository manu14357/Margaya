import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateStickyRequest = InferRequestType<
  (typeof client)["sticky"]["$post"]
>["json"];

async function createSticky(request: CreateStickyRequest) {
  const response = await client.sticky.$post({ json: request });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createSticky;
