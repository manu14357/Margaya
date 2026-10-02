import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function markIntakeDuplicate(
  id: string,
  duplicateOfTaskId: string,
  note?: string,
) {
  const response = await client.intake.item[":id"].duplicate.$post({
    param: { id },
    json: { duplicateOfTaskId, note },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default markIntakeDuplicate;
