import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { CreateIntakeRequest } from "@/types/intake";

async function createIntakeItem(projectId: string, json: CreateIntakeRequest) {
  const response = await client.intake.project[":projectId"].$post({
    param: { projectId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createIntakeItem;
