import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteMattermostIntegration(projectId: string) {
  const response = await client["mattermost-integration"].project[
    ":projectId"
  ].$delete({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteMattermostIntegration;
