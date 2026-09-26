import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Archives a project: hidden from lists, everything in it is kept. */
async function archiveProject(id: string) {
  const response = await client.project[":id"].archive.$put({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default archiveProject;
