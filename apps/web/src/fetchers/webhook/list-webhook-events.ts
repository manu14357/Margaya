import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** The public event catalog by family. */
async function listWebhookEvents() {
  const response = await client.webhook.events.$get();

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listWebhookEvents;
