import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getInboxCounts(workspaceId: string) {
  const response = await client.notification.counts.$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getInboxCounts;
