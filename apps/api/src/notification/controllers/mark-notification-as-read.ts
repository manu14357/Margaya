import updateNotificationState from "./update-notification-state";

async function markNotificationAsRead(id: string, userId: string) {
  return updateNotificationState(id, userId, { action: "read" });
}

export default markNotificationAsRead;
