import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { UpdateViewRequest } from "@/types/view";

/** Nested objects merge over the stored ones; filters.root null clears. */
async function updateView(viewId: string, json: UpdateViewRequest) {
  const response = await client.view[":id"].$patch({
    param: { id: viewId },
    json,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateView;
