import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** A new signing secret, shown once; the previous one stays valid for graceHours. */
async function rotateWebhookSecret(id: string, graceHours: number) {
  const response = await client.webhook[":id"]["rotate-secret"].$post({
    param: { id },
    json: { graceHours },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default rotateWebhookSecret;
