import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteSlackIntegration(projectId: string) {
  const response = await client["slack-integration"].project[
    ":projectId"
  ].$delete({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteSlackIntegration;
