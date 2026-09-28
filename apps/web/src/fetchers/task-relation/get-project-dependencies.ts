import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function getProjectDependencies(projectId: string) {
  const response = await client["task-relation"].project[":projectId"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getProjectDependencies;
