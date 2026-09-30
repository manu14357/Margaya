import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Locks a view (read-only for everyone) or unlocks it. */
async function setViewLock(viewId: string, locked: boolean) {
  const route = locked ? client.view[":id"].lock : client.view[":id"].unlock;
  const response = await route.$post({ param: { id: viewId } });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default setViewLock;
