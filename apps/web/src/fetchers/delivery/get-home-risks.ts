import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** GET /api/delivery/home/risks: the top risks of the current cycles. */
async function getHomeRisks(workspaceId: string, signal?: AbortSignal) {
  const response = await client.delivery.home.risks.$get(
    { query: { workspaceId } },
    { init: { signal } },
  );

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getHomeRisks;
