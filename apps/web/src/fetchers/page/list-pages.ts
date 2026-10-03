import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Every page of the project the caller can see, archived included. */
async function listPages(projectId: string) {
  const response = await client.page.project[":projectId"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default listPages;
