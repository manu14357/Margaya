import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { CreateWebhookInput } from "@/types/webhook";

/** Creates a webhook; the answer carries the signing secret, shown once. */
async function createWebhook(input: CreateWebhookInput) {
  const response = await client.webhook.$post({ json: input });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createWebhook;
