import type { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

type WebhookRoutes = (typeof client)["webhook"];

/** A workspace webhook as the list returns it; never carries the secret. */
export type Webhook = InferResponseType<WebhookRoutes["$get"], 200>[number];

/** One webhook with its pending-delivery count. */
export type WebhookDetail = InferResponseType<
  WebhookRoutes[":id"]["$get"],
  200
>;

/** Returned only on create and on rotate: the secret is shown once. */
export type WebhookWithSecret = InferResponseType<WebhookRoutes["$post"], 200>;

export type CreateWebhookInput = InferRequestType<
  WebhookRoutes["$post"]
>["json"];

export type UpdateWebhookInput = InferRequestType<
  WebhookRoutes[":id"]["$patch"]
>["json"];

export type WebhookEventCatalog = InferResponseType<
  WebhookRoutes["events"]["$get"],
  200
>;

export type WebhookDeliveryPage = InferResponseType<
  WebhookRoutes[":id"]["deliveries"]["$get"],
  200
>;

export type WebhookDeliverySummary = WebhookDeliveryPage["items"][number];

export type WebhookDeliveryDetail = InferResponseType<
  WebhookRoutes[":id"]["deliveries"][":deliveryId"]["$get"],
  200
>;

export type WebhookDeliveryStatus = WebhookDeliverySummary["status"];

/** The deliveries toolbar's status filter; inProgress means pending or sending. */
export type DeliveryStatusFilter =
  | "all"
  | "succeeded"
  | "failed"
  | "inProgress"
  | "cancelled";

export type WebhookDeliveryFilters = {
  status: DeliveryStatusFilter;
  event: string | null;
};
