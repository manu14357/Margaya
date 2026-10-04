import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Sends webhook.ping once and resolves with the finished test delivery. */
async function testWebhook(id: string) {
  const response = await client.webhook[":id"].test.$post({ param: { id } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default testWebhook;
