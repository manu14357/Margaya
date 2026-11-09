import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/**
 * Sets the projects a pending invitation adds its invitee to, each with a
 * project role. The API refuses a project the caller may not share.
 */
async function setInvitationProjects(
  invitationId: string,
  projects: { projectId: string; role: string }[],
) {
  const response = await client.invitation[":id"].projects.$put({
    param: { id: invitationId },
    json: { projects },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default setInvitationProjects;
