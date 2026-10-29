import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function deleteGenericWebhookIntegration(projectId: string) {
  const response = await client["generic-webhook-integration"].project[
    ":projectId"
  ].$delete({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default deleteGenericWebhookIntegration;
