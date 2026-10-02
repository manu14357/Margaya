import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateHomePreferencesRequest = InferRequestType<
  (typeof client)["home"]["preferences"]["$put"]
>["json"];

async function updateHomePreferences(request: UpdateHomePreferencesRequest) {
  const response = await client.home.preferences.$put({ json: request });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateHomePreferences;
