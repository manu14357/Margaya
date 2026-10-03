import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Moves the page and its sub-pages to another project of the workspace. */
async function movePageToProject(pageId: string, projectId: string) {
  const response = await client.page[":id"].move.$post({
    param: { id: pageId },
    json: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default movePageToProject;
