import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { AnalyticsScopeParams } from "@/types/analytics";
import { scopeQuery } from "./scope-query";

/** GET /api/analytics/overview: the workspace's headline numbers. */
async function getAnalyticsOverview(
  params: AnalyticsScopeParams,
  signal?: AbortSignal,
) {
  const response = await client.analytics.overview.$get(
    { query: scopeQuery(params) },
    { init: { signal } },
  );

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getAnalyticsOverview;
