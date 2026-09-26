import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** A project's scheduled automations; both rules are off until first set. */
async function getProjectAutomations(projectId: string) {
  const response = await client["project-automation"][":projectId"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getProjectAutomations;
