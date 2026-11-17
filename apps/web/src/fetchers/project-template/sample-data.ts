import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Moves a project's example tasks to the trash as one batch. */
async function removeSampleData({ projectId }: { projectId: string }) {
  const response = await client["project-template"].project[":projectId"][
    "remove-sample-data"
  ].$post({ param: { projectId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default removeSampleData;
