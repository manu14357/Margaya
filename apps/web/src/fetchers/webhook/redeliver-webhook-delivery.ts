import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Queues a new delivery with the same body, linked to the original. */
async function redeliverWebhookDelivery(webhookId: string, deliveryId: string) {
  const response = await client.webhook[":id"].deliveries[
    ":deliveryId"
  ].redeliver.$post({
    param: { id: webhookId, deliveryId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default redeliverWebhookDelivery;
