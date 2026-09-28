import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Makes the description that version's text; returns the updated task. */
async function restoreDescriptionVersion(taskId: string, versionId: string) {
  const response = await client.task[":id"]["description-versions"][
    ":versionId"
  ].restore.$post({ param: { id: taskId, versionId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default restoreDescriptionVersion;
