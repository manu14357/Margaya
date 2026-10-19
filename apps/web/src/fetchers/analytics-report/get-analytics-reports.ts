import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** The workspace's shared reports plus the caller's private ones. */
async function getAnalyticsReports(workspaceId: string) {
  const response = await client["analytics-report"].$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getAnalyticsReports;
