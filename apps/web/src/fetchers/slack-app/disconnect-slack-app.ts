import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function disconnectSlackApp(workspaceId: string) {
  const response = await client["slack-app"].workspace[":workspaceId"].$delete({
    param: { workspaceId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default disconnectSlackApp;
