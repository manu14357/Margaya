import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type db from "../database";
import { taskTable } from "../database/schema";
import { publishEvent } from "../events";
import {
  displayHost,
  normalizeLinkTitle,
  normalizeLinkUrl,
} from "../utils/link-url";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const MAX_TASK_LINKS = 100;
export const DUPLICATE_LINK = "This link is already on this task";
const UNIQUE_CONSTRAINT = "task_link_task_url_unique";

export function requireLinkUrl(raw: string): string {
  const result = normalizeLinkUrl(raw);
  if (!result.ok) throw new HTTPException(400, { message: result.message });
  return result.url;
}

export function requireLinkTitle(raw: string | null | undefined) {
  const result = normalizeLinkTitle(raw);
  if (!result.ok) throw new HTTPException(400, { message: result.message });
  return result.title;
}

/**
 * Locks the task row, so the cap and duplicate checks of concurrent writes
 * to its links run one after the other.
 */
export async function lockLinkTask(tx: Transaction, taskId: string) {
  const [task] = await tx
    .select({ id: taskTable.id, projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .for("update");
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return task;
}

/** Runs a link write, mapping a lost race on the URL index to the 409. */
export async function withDuplicateMapped<T>(write: () => Promise<T>) {
  try {
    return await write();
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "23505" &&
      "constraint" in cause &&
      cause.constraint === UNIQUE_CONSTRAINT
    ) {
      throw new HTTPException(409, { message: DUPLICATE_LINK });
    }
    throw error;
  }
}

type LinkSnapshot = { id: string; url: string; title: string | null };

export async function publishLinkEvent(
  eventName: "task.link_created" | "task.link_updated" | "task.link_deleted",
  {
    link,
    previous,
    taskId,
    projectId,
    userId,
  }: {
    link: LinkSnapshot;
    previous?: LinkSnapshot;
    taskId: string;
    projectId: string;
    userId: string;
  },
) {
  await publishEvent(eventName, {
    taskId,
    projectId,
    userId,
    linkId: link.id,
    url: link.url,
    title: link.title,
    host: displayHost(link.url),
    ...(previous ? { oldUrl: previous.url, oldTitle: previous.title } : {}),
  });
}
