import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { PushStatus } from "./get-push-status";

async function deletePushSubscription(id: string): Promise<PushStatus> {
  const response = await client["notification-preferences"].push.subscriptions[
    ":id"
  ].$delete({ param: { id } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deletePushSubscription;
