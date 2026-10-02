import type { InboxNotification } from "@/types/notification";

/** A task comment notification, unread, in the Inbox view. */
export function inboxNotification(
  overrides: Partial<InboxNotification> = {},
): InboxNotification {
  return {
    id: "n1",
    userId: "me",
    title: null,
    content: null,
    type: "task_comment",
    eventData: {
      taskTitle: "Ship it",
      commenterName: "Ana",
      commentPreview: "Looks good",
      commentId: "c1",
    },
    isRead: false,
    resourceId: "task-1",
    resourceType: "task",
    workspaceId: "ws",
    actorId: "ana",
    archivedAt: null,
    snoozedUntil: null,
    resurfacedAt: null,
    createdAt: "2026-09-26T10:00:00.000Z",
    updatedAt: "2026-09-26T10:00:00.000Z",
    actor: { id: "ana", name: "Ana Silva", image: null },
    task: {
      id: "task-1",
      key: "WEB-12",
      title: "Ship it",
      projectId: "project-1",
      projectName: "Website",
    },
    sortAt: "2026-09-26T10:00:00.000Z",
    isSnoozed: false,
    ...overrides,
  };
}
