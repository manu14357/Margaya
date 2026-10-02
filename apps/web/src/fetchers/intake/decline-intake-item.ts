import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function declineIntakeItem(id: string, note?: string) {
  const response = await client.intake.item[":id"].decline.$post({
    param: { id },
    json: { note },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default declineIntakeItem;
