import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { NotificationPreferences } from "./get-notification-preferences";

async function deleteNotificationWorkspaceRule(
  workspaceId: string,
): Promise<NotificationPreferences> {
  const response = await client["notification-preferences"].workspaces[
    ":workspaceId"
  ].$delete({ param: { workspaceId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteNotificationWorkspaceRule;
