import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { UpdateAnalyticsReportInput } from "@/types/analytics-report";

/** Renames a report, changes its visibility or its configuration. */
async function updateAnalyticsReport(
  id: string,
  changes: UpdateAnalyticsReportInput,
) {
  const response = await client["analytics-report"][":id"].$patch({
    param: { id },
    json: changes,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateAnalyticsReport;
