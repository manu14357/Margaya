import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getIntakeSummary(projectId: string) {
  const response = await client.intake.project[":projectId"].summary.$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getIntakeSummary;
