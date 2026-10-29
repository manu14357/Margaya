import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import type { NotificationPreferences } from "./get-notification-preferences";

export type UpdateNotificationPreferencesRequest = InferRequestType<
  (typeof client)["notification-preferences"]["$put"]
>["json"];

async function updateNotificationPreferences(
  json: UpdateNotificationPreferencesRequest,
): Promise<NotificationPreferences> {
  const response = await client["notification-preferences"].$put({ json });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateNotificationPreferences;
