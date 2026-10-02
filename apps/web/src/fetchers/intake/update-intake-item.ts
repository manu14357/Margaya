import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { UpdateIntakeRequest } from "@/types/intake";

async function updateIntakeItem(id: string, json: UpdateIntakeRequest) {
  const response = await client.intake.item[":id"].$patch({
    param: { id },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateIntakeItem;
