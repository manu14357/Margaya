import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { AnalyticsChartRequest } from "@/types/analytics";

/** POST /api/analytics/chart: a custom chart's buckets and segments. */
async function queryAnalyticsChart(
  request: AnalyticsChartRequest,
  signal?: AbortSignal,
) {
  const response = await client.analytics.chart.$post(
    { json: request },
    { init: { signal } },
  );

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default queryAnalyticsChart;
