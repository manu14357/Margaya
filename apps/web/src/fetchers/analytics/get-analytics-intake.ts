import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type {
  AnalyticsDateBucket,
  AnalyticsScopeParams,
} from "@/types/analytics";
import { scopeQuery } from "./scope-query";

export type AnalyticsIntakeParams = AnalyticsScopeParams & {
  from: string;
  to: string;
  bucket: AnalyticsDateBucket;
  weekStartsOn: 0 | 1 | 6;
};

/** GET /api/analytics/intake: request counts, series and triage time. */
async function getAnalyticsIntake(
  { from, to, bucket, weekStartsOn, ...scope }: AnalyticsIntakeParams,
  signal?: AbortSignal,
) {
  const response = await client.analytics.intake.$get(
    {
      query: {
        ...scopeQuery(scope),
        from,
        to,
        bucket,
        weekStartsOn: String(weekStartsOn) as "0" | "1" | "6",
      },
    },
    { init: { signal } },
  );

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getAnalyticsIntake;
