import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { CreateAnalyticsReportInput } from "@/types/analytics-report";

/** Saves a chart-builder configuration as a report owned by the caller. */
async function createAnalyticsReport(input: CreateAnalyticsReportInput) {
  const response = await client["analytics-report"].$post({ json: input });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createAnalyticsReport;
