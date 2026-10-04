import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Deletes a webhook with its pending deliveries and delivery log. */
async function deleteWebhook(id: string) {
  const response = await client.webhook[":id"].$delete({ param: { id } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteWebhook;
