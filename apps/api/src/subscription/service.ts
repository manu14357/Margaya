import { sql } from "drizzle-orm";
import db from "../database";
import { taskSubscriberTable } from "../database/schema";

// Writers and the reader of task subscriptions (B10 §3.5). A row with
// `subscribed = false` is an explicit unsubscribe (muted). A task's
// watchers are its subscribed rows plus its assignees, minus muted rows.

export const SUBSCRIPTION_REASONS = [
  "creator",
  "assignee",
  "commenter",
  "mention",
  "manual",
] as const;

export type SubscriptionReason = (typeof SUBSCRIPTION_REASONS)[number];

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Writer = Pick<Transaction, "insert" | "execute">;

/**
 * Subscribes the users (an auto-subscribe re-subscribes a muted row). The
 * reason changes only when the row was muted or manual, so a stronger
 * history such as `creator` is kept. Publishes nothing: auto-subscribes
 * are silent.
 */
export async function subscribeUsers(
  taskId: string,
  userIds: readonly (string | null | undefined)[],
  reason: SubscriptionReason,
  writer: Writer = db,
): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  await writer
    .insert(taskSubscriberTable)
    .values(ids.map((userId) => ({ taskId, userId, subscribed: true, reason })))
    .onConflictDoUpdate({
      target: [taskSubscriberTable.taskId, taskSubscriberTable.userId],
      set: {
        subscribed: true,
        reason: sql`excluded.reason`,
        updatedAt: new Date(),
      },
      setWhere: sql`${taskSubscriberTable.subscribed} = false or ${taskSubscriberTable.reason} = 'manual'`,
    });
}

/** Explicitly unsubscribes the user (a muted row, reason `manual`). */
export async function muteUser(
  taskId: string,
  userId: string,
  writer: Writer = db,
): Promise<void> {
  await writer
    .insert(taskSubscriberTable)
    .values({ taskId, userId, subscribed: false, reason: "manual" })
    .onConflictDoUpdate({
      target: [taskSubscriberTable.taskId, taskSubscriberTable.userId],
      set: { subscribed: false, reason: "manual", updatedAt: new Date() },
      setWhere: sql`${taskSubscriberTable.subscribed} = true or ${taskSubscriberTable.reason} <> 'manual'`,
    });
}

export type SubscriptionState = {
  taskId: string;
  /** The effective state: a subscribed row, or an assignee not muted. */
  subscribed: boolean;
  reason: SubscriptionReason | null;
  isAssignee: boolean;
  isMuted: boolean;
  /** Distinct watchers: subscribed rows ∪ assignees − muted rows. */
  subscriberCount: number;
};

export function toSubscriptionState(input: {
  taskId: string;
  rowSubscribed: boolean | null;
  rowReason: string | null;
  isAssignee: boolean;
  subscriberCount: number;
}): SubscriptionState {
  const isMuted = input.rowSubscribed === false;
  const subscribed =
    input.rowSubscribed === true || (input.isAssignee && !isMuted);
  const reason = !subscribed
    ? null
    : input.rowSubscribed === true
      ? (SUBSCRIPTION_REASONS as readonly string[]).includes(
          input.rowReason ?? "",
        )
        ? (input.rowReason as SubscriptionReason)
        : "manual"
      : "assignee";
  return {
    taskId: input.taskId,
    subscribed,
    reason,
    isAssignee: input.isAssignee,
    isMuted,
    subscriberCount: input.subscriberCount,
  };
}

/** The caller's subscription to a task, in one statement. */
export async function getSubscriptionState(
  taskId: string,
  userId: string,
): Promise<SubscriptionState> {
  const result = await db.execute<{
    row_subscribed: boolean | null;
    row_reason: string | null;
    is_assignee: boolean;
    subscriber_count: string | number;
  }>(sql`
    select
      (select s.subscribed from task_subscriber s
        where s.task_id = ${taskId} and s.user_id = ${userId}) as row_subscribed,
      (select s.reason from task_subscriber s
        where s.task_id = ${taskId} and s.user_id = ${userId}) as row_reason,
      exists (select 1 from task_assignee a
        where a.task_id = ${taskId} and a.user_id = ${userId}) as is_assignee,
      (select count(*) from (
        select s.user_id from task_subscriber s
          where s.task_id = ${taskId} and s.subscribed
        union
        select a.user_id from task_assignee a where a.task_id = ${taskId}
      ) as watcher
      where not exists (
        select 1 from task_subscriber m
        where m.task_id = ${taskId} and m.user_id = watcher.user_id
          and m.subscribed = false
      )) as subscriber_count
  `);
  const row = result.rows[0];
  return toSubscriptionState({
    taskId,
    rowSubscribed: row?.row_subscribed ?? null,
    rowReason: row?.row_reason ?? null,
    isAssignee: row?.is_assignee === true,
    subscriberCount: Number(row?.subscriber_count ?? 0),
  });
}
