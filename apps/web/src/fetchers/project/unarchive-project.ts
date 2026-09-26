import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Restores an archived project to the lists. */
async function unarchiveProject(id: string) {
  const response = await client.project[":id"].unarchive.$put({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default unarchiveProject;
