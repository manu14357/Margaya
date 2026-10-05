import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Archived counts of the workspace, or of one project; null hides a tab. */
async function getArchiveSummary(workspaceId: string, projectId?: string) {
  const response = await client.archive.summary.$get({
    query: { workspaceId, projectId: projectId || undefined },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getArchiveSummary;
