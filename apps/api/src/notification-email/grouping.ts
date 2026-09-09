import type { NotificationBatchGroup } from "@margaya/email";

/** One queued notification that passed every send-time check. */
export type BatchItem = {
  notificationId: string;
  createdAt: Date;
  /** Short title, e.g. "Task status changed". */
  title: string;
  /** Sentence, e.g. "Draft moved from To do to Done." */
  body: string;
  actorName: string | null;
  task: {
    id: string;
    title: string;
    url: string;
    projectName: string;
  } | null;
  workspaceName: string;
};

/**
 * Groups items by task, oldest first, each group's changes in the order
 * they happened. Items without a task (workspace notices) stay on their own.
 */
export function groupBatchItems(
  items: readonly BatchItem[],
): NotificationBatchGroup[] {
  const ordered = [...items].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.notificationId < b.notificationId ? -1 : 1),
  );
  const groups: NotificationBatchGroup[] = [];
  const byTask = new Map<string, NotificationBatchGroup>();

  for (const item of ordered) {
    const change = {
      id: item.notificationId,
      summary: item.title,
      detail: item.body,
      actorName: item.actorName,
    };
    if (!item.task) {
      groups.push({
        id: item.notificationId,
        title: item.title,
        context: item.workspaceName,
        url: null,
        changes: [change],
      });
      continue;
    }
    let group = byTask.get(item.task.id);
    if (!group) {
      group = {
        id: item.task.id,
        title: item.task.title,
        context: `${item.workspaceName} / ${item.task.projectName}`,
        url: item.task.url,
        changes: [],
      };
      byTask.set(item.task.id, group);
      groups.push(group);
    }
    group.changes.push(change);
  }
  return groups;
}

/** The subject of a batched email (two or more changes). */
export function batchSubject(groups: readonly NotificationBatchGroup[]) {
  const changes = groups.reduce((sum, group) => sum + group.changes.length, 0);
  const [only] = groups;
  if (groups.length === 1 && only?.url) {
    return `${changes} updates on ${only.title}`;
  }
  return `${changes} updates in Margaya`;
}
