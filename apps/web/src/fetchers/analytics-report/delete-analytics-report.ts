import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteAnalyticsReport(id: string) {
  const response = await client["analytics-report"][":id"].$delete({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteAnalyticsReport;
