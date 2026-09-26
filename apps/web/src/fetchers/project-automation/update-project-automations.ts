import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { UpdateProjectAutomationsInput } from "@/types/project-automation";

/** Turns rules on or off, or changes their months or auto-close column. */
async function updateProjectAutomations(
  projectId: string,
  patch: UpdateProjectAutomationsInput,
) {
  const response = await client["project-automation"][":projectId"].$patch({
    param: { projectId },
    json: patch,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateProjectAutomations;
