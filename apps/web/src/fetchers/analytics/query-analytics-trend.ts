import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { AnalyticsTrendRequest } from "@/types/analytics";

/** POST /api/analytics/trend: created vs completed per week or month. */
async function queryAnalyticsTrend(
  request: AnalyticsTrendRequest,
  signal?: AbortSignal,
) {
  const response = await client.analytics.trend.$post(
    { json: request },
    { init: { signal } },
  );

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default queryAnalyticsTrend;
