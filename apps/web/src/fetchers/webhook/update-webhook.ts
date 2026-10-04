import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { UpdateWebhookInput } from "@/types/webhook";

/** Changes the name, URL, events or active state (only what is sent). */
async function updateWebhook(id: string, input: UpdateWebhookInput) {
  const response = await client.webhook[":id"].$patch({
    param: { id },
    json: input,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateWebhook;
