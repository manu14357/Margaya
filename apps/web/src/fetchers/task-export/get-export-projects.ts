import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Every project of the workspace, archived ones included, in sidebar order. */
async function getExportProjects(workspaceId: string) {
  const response = await client.project.$get({
    query: { workspaceId, includeArchived: "true" },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getExportProjects;
