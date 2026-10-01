import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { AnalyticsScopeParams } from "@/types/analytics";
import { scopeQuery } from "./scope-query";

/** GET /api/analytics/modules: module rows and a summary by status. */
async function getAnalyticsModules(
  params: AnalyticsScopeParams,
  signal?: AbortSignal,
) {
  const response = await client.analytics.modules.$get(
    { query: scopeQuery(params) },
    { init: { signal } },
  );

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getAnalyticsModules;
