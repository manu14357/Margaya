import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type NotificationPreferences = InferResponseType<
  (typeof client)["notification-preferences"]["$get"],
  200
>;

export type NotificationPreferenceWorkspaceRule =
  NotificationPreferences["workspaces"][number];

async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const response = await client["notification-preferences"].$get();

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getNotificationPreferences;
