import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** The workspace's webhooks, newest first. */
async function listWebhooks(workspaceId: string) {
  const response = await client.webhook.$get({ query: { workspaceId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listWebhooks;
