import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** The views the caller can see: a project's, or the workspace's. */
async function listViews({
  workspaceId,
  projectId,
  mine,
}: {
  workspaceId: string;
  projectId?: string | null;
  mine?: boolean;
}) {
  const response = await client.view.$get({
    query: {
      workspaceId,
      ...(projectId ? { projectId } : {}),
      ...(mine ? { mine: "true" as const } : {}),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listViews;
