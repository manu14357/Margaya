import { client } from "@margaya/libs";

import { HttpError } from "@/lib/http-error";
import type { InboxTab, InboxType, InboxView } from "@/types/notification";

/** Narrows "mark all read" to one workspace's inbox, tab, view and types. */
export type MarkAllReadScope = {
  workspaceId: string;
  tab: InboxTab;
  view: InboxView;
  types: InboxType[];
};

async function markAllNotificationsAsRead(scope?: MarkAllReadScope) {
  const response = await client.notification["read-all"].$patch({
    query: scope
      ? {
          workspaceId: scope.workspaceId,
          tab: scope.tab,
          view: scope.view,
          types: scope.types.length > 0 ? scope.types.join(",") : undefined,
        }
      : {},
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();
  return data;
}

export default markAllNotificationsAsRead;
