import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

export type TaskSubscription = InferResponseType<
  (typeof client)["subscription"]["task"][":taskId"]["$get"],
  200
>;

export type SubscriptionReason = NonNullable<TaskSubscription["reason"]>;
