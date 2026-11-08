import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import type { PushStatus } from "./get-push-status";

export type SavePushSubscriptionRequest = InferRequestType<
  (typeof client)["notification-preferences"]["push"]["subscriptions"]["$put"]
>["json"];

async function savePushSubscription(
  json: SavePushSubscriptionRequest,
): Promise<PushStatus> {
  const response = await client[
    "notification-preferences"
  ].push.subscriptions.$put({ json });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default savePushSubscription;
