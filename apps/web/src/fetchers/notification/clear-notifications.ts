import { client } from "@margaya/libs";

import { HttpError } from "@/lib/http-error";

/** Deletes the caller's notifications of one workspace (all without one). */
async function clearNotifications(workspaceId?: string) {
  const response = await client.notification["clear-all"].$delete({
    query: workspaceId ? { workspaceId } : {},
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();
  return data;
}

export default clearNotifications;
