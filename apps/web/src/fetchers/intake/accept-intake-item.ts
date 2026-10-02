import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** `status` is a board column slug, or `planned` for the backlog. */
async function acceptIntakeItem(id: string, status: string) {
  const response = await client.intake.item[":id"].accept.$post({
    param: { id },
    json: { status },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default acceptIntakeItem;
