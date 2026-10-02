import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** `until` is an ISO instant with an offset. */
async function snoozeIntakeItem(id: string, until: string) {
  const response = await client.intake.item[":id"].snooze.$post({
    param: { id },
    json: { until },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default snoozeIntakeItem;
