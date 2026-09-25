import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateFavoriteRequest = InferRequestType<
  (typeof client)["favorite"]["$post"]
>["json"];

async function createFavorite(request: CreateFavoriteRequest) {
  const response = await client.favorite.$post({ json: request });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createFavorite;
