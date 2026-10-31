/**
 * The `notification.created` payload. Besides the ids it carries the type
 * and two flags, no content: the recipient's tabs pick a sound from them
 * without fetching the row.
 */
export function notificationCreatedEvent(row: {
  id: string;
  userId: string;
  type: string;
  eventData: unknown;
}) {
  const data =
    row.eventData && typeof row.eventData === "object"
      ? (row.eventData as Record<string, unknown>)
      : {};
  return {
    notificationId: row.id,
    userId: row.userId,
    notificationType: row.type,
    reply: typeof data.parentCommentId === "string",
    needsInput: data.needsInput === true,
  };
}

export type NotificationCreatedEvent = ReturnType<
  typeof notificationCreatedEvent
>;
