import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { scopeQuery } from "@/fetchers/analytics/scope-query";
import { HttpError } from "@/lib/http-error";
import type { AnalyticsScopeParams } from "@/types/analytics";

export type TimeReport = InferResponseType<
  (typeof client)["time-entry"]["report"]["$get"],
  200
>;

export type TimeReportParams = AnalyticsScopeParams & {
  from: string;
  to: string;
};

async function getTimeReport(
  { from, to, ...scope }: TimeReportParams,
  signal?: AbortSignal,
) {
  const response = await client["time-entry"].report.$get(
    { query: { ...scopeQuery(scope), from, to } },
    { init: { signal } },
  );

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getTimeReport;
