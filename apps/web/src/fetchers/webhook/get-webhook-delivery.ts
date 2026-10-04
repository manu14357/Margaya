import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** One delivery with its attempts, request and last response snippet. */
async function getWebhookDelivery(webhookId: string, deliveryId: string) {
  const response = await client.webhook[":id"].deliveries[":deliveryId"].$get({
    param: { id: webhookId, deliveryId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getWebhookDelivery;
