import type { AiScope } from "../ai/context";
import getInbox from "../notification/controllers/get-inbox";
import type { InsightTaskRef } from "./shared";

// "Summarize unread": a short AI digest of the caller's unread inbox in one
// workspace. The rows come from the inbox query itself (the same access
// rules as the list), then only what AI may read is kept: task
// notifications of projects in the AI scope, and workspace-level notices.

/** Unread rows read for one digest; the newest win. */
export const INBOX_DIGEST_LIMIT = 60;

export const INBOX_DIGEST_INSTRUCTIONS = `You write a short digest of a person's unread notifications in a project tracker.
Rules:
- Use ONLY the notifications given. Never invent tasks, people, dates or numbers.
- Start with one sentence on what needs attention first (mentions, assignments, approvals, due or blocked work), then up to five bullets grouping the rest by task or theme.
- Cite tasks by key in square brackets, such as [WEB-12]. Mention only tasks listed.
- Address the reader as "you". If there is nothing unread, say so in one sentence.`;

export type DigestRow = {
  type: string;
  title: string | null;
  content: string | null;
  createdAt: Date;
  actor: string | null;
  task: InsightTaskRef | null;
  projectId: string | null;
  resourceType: string | null;
};

type InboxItem = Awaited<ReturnType<typeof getInbox>>["items"][number];

function projectIdOf(item: InboxItem): string | null {
  if (item.task) return item.task.projectId;
  const data = item.eventData as Record<string, unknown> | null;
  return typeof data?.projectId === "string" ? data.projectId : null;
}

/** Pure: the rows AI may read under this scope. */
export function digestRows(
  items: readonly InboxItem[],
  scope: Pick<AiScope, "projectIds">,
): DigestRow[] {
  const rows: DigestRow[] = [];
  for (const item of items) {
    const projectId = projectIdOf(item);
    // Pages and other project content outside AI's reach stay out; a
    // workspace notice with no project is fine.
    if (
      projectId
        ? !scope.projectIds.has(projectId)
        : item.resourceType !== "workspace" && item.resourceType !== null
    ) {
      continue;
    }
    rows.push({
      type: item.type,
      title: item.title,
      content: item.content,
      createdAt: item.createdAt,
      actor: item.actor?.name ?? null,
      task: item.task
        ? {
            id: item.task.id,
            key: item.task.key,
            title: item.task.title,
            projectId: item.task.projectId,
          }
        : null,
      projectId,
      resourceType: item.resourceType,
    });
  }
  return rows;
}

/** One line per notification for the prompt (untrusted text). */
export function digestLine(row: DigestRow): string {
  const text = (value: string | null, max: number) =>
    value?.replace(/\s+/g, " ").trim().slice(0, max) ?? "";
  return [
    row.createdAt.toISOString().slice(0, 16).replace("T", " "),
    row.type,
    row.actor ? `from ${row.actor}` : null,
    row.task ? `[${row.task.key}] ${text(row.task.title, 160)}` : null,
    text(row.title, 160) || null,
    text(row.content, 300) ? `— ${text(row.content, 300)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function loadInboxDigest(scope: AiScope) {
  const { items } = await getInbox({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    tab: "all",
    view: "inbox",
    unread: true,
    types: [],
    limit: INBOX_DIGEST_LIMIT,
  });
  const rows = digestRows(items, scope);
  return { rows, unread: items.length, omitted: items.length - rows.length };
}
