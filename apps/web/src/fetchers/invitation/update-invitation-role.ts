import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Changes the role a pending invitation grants; the API enforces the ceiling. */
async function updateInvitationRole(invitationId: string, role: string) {
  const response = await client.invitation[":id"].role.$patch({
    param: { id: invitationId },
    json: { role },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateInvitationRole;
