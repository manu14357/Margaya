import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getRunningTimeEntry(workspaceId: string) {
  const response = await client["time-entry"].running.$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getRunningTimeEntry;
