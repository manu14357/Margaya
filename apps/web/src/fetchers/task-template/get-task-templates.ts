import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** A project's task templates, in their order. */
async function getTaskTemplates(projectId: string) {
  const response = await client["task-template"].project[":projectId"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getTaskTemplates;
