import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UserPreferencesPatch = InferRequestType<
  typeof client.user.preferences.$patch
>["json"];

async function updateUserPreferences(patch: UserPreferencesPatch) {
  const response = await client.user.preferences.$patch({ json: patch });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateUserPreferences;
