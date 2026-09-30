import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Saves a manual order; the API renumbers positions to 0..n-1. */
async function reorderModules(projectId: string, moduleIds: string[]) {
  const response = await client.module.project[":projectId"].reorder.$put({
    param: { projectId },
    json: {
      modules: moduleIds.map((id, position) => ({ id, position })),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default reorderModules;
