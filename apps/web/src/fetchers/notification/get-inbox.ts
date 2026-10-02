import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { InboxFilters } from "@/types/notification";

export type GetInboxRequest = InboxFilters & {
  workspaceId: string;
  limit: number;
  cursor?: string;
};

async function getInbox({
  workspaceId,
  tab,
  view,
  unread,
  types,
  limit,
  cursor,
}: GetInboxRequest) {
  const response = await client.notification.inbox.$get({
    query: {
      workspaceId,
      tab,
      view,
      unread: unread ? "true" : undefined,
      types: types.length > 0 ? types.join(",") : undefined,
      limit: String(limit),
      cursor,
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getInbox;
