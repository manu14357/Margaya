import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function revokeSession(sessionId: string) {
  const response = await client.user.sessions[":id"].$delete({
    param: { id: sessionId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to sign out the session");
  }

  return response.json();
}

export default revokeSession;
