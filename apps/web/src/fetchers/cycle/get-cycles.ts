import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { CycleListView } from "@/types/cycle";

async function getCycles(projectId: string, view: CycleListView = "all") {
  const response = await client.cycle.project[":projectId"].$get({
    param: { projectId },
    query: { view },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getCycles;
