import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { NotificationStateAction } from "@/types/notification";

/** Read, unread, archive, unarchive, snooze or unsnooze one notification. */
async function updateNotificationState(
  id: string,
  change: NotificationStateAction,
) {
  const route = client.notification[":id"];
  const param = { id };
  const response = await (() => {
    switch (change.action) {
      case "read":
        return route.read.$patch({ param });
      case "unread":
        return route.unread.$patch({ param });
      case "archive":
        return route.archive.$patch({ param });
      case "unarchive":
        return route.unarchive.$patch({ param });
      case "snooze":
        return route.snooze.$patch({ param, json: { until: change.until } });
      case "unsnooze":
        return route.unsnooze.$patch({ param });
    }
  })();

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateNotificationState;
