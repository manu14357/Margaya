import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import type { NotificationPreferences } from "./get-notification-preferences";

export type UpsertNotificationWorkspaceRuleRequest = InferRequestType<
  (typeof client)["notification-preferences"]["workspaces"][":workspaceId"]["$put"]
>["json"];

async function upsertNotificationWorkspaceRule(
  workspaceId: string,
  json: UpsertNotificationWorkspaceRuleRequest,
): Promise<NotificationPreferences> {
  const response = await client["notification-preferences"].workspaces[
    ":workspaceId"
  ].$put({ param: { workspaceId }, json });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default upsertNotificationWorkspaceRule;
