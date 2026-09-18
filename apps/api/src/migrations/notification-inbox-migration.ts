import { sql } from "drizzle-orm";
import db from "../database";

// The editor's mention tag, as parseMentionIds reads it (PostgreSQL regex).
const MENTION_TAG_PATTERN = '<margaya-mention[^>]*\\yid="([^"]+)"';

async function tableIsEmpty(table: "task_mention" | "task_subscriber") {
  const result = await db.execute(
    sql`select 1 from ${sql.identifier(table)} limit 1`,
  );
  return (result.rowCount ?? result.rows.length) === 0;
}

/** Steps 1 and 2: the workspace of task and workspace notifications. */
async function backfillNotificationWorkspaces(): Promise<number> {
  const tasks = await db.execute(sql`
    update notification as n
    set workspace_id = p.workspace_id
    from task as t
    join project as p on p.id = t.project_id
    where n.workspace_id is null
      and n.resource_type = 'task'
      and t.id = n.resource_id
  `);
  const workspaces = await db.execute(sql`
    update notification as n
    set workspace_id = w.id
    from workspace as w
    where n.workspace_id is null
      and n.resource_type = 'workspace'
      and w.id = n.resource_id
  `);
  return (tasks.rowCount ?? 0) + (workspaces.rowCount ?? 0);
}

/** Step 3: mentions of current members in descriptions and comments. */
async function backfillMentions(): Promise<number> {
  if (!(await tableIsEmpty("task_mention"))) return 0;
  const result = await db.execute(sql`
    insert into task_mention (id, task_id, user_id, comment_id, created_at)
    select gen_random_uuid()::text, src.task_id, src.user_id, src.comment_id, now()
    from (
      select distinct t.id as task_id, m[1] as user_id, null::text as comment_id
      from task as t,
        regexp_matches(t.description, ${MENTION_TAG_PATTERN}, 'gi') as m
      where t.description like '%<margaya-mention%'
      union
      select distinct a.task_id, m[1], a.id
      from activity as a,
        regexp_matches(a.content, ${MENTION_TAG_PATTERN}, 'gi') as m
      where a.type = 'comment' and a.content like '%<margaya-mention%'
    ) as src
    join "user" as u on u.id = src.user_id
    join task as mentioned_task on mentioned_task.id = src.task_id
    join project as p on p.id = mentioned_task.project_id
    where exists (
      select 1 from workspace_member as wm
      where wm.workspace_id = p.workspace_id and wm.user_id = src.user_id
    )
    on conflict do nothing
  `);
  return result.rowCount ?? 0;
}

/**
 * Step 4: creators, assignees, commenters (not imported comments) and
 * mentioned users, each pair once with its strongest reason.
 */
async function backfillSubscriptions(): Promise<number> {
  if (!(await tableIsEmpty("task_subscriber"))) return 0;
  const result = await db.execute(sql`
    insert into task_subscriber
      (id, task_id, user_id, subscribed, reason, created_at, updated_at)
    select gen_random_uuid()::text, pick.task_id, pick.user_id, true,
      pick.reason, now(), now()
    from (
      select distinct on (src.task_id, src.user_id)
        src.task_id, src.user_id, src.reason
      from (
        select t.id as task_id, t.created_by as user_id,
          'creator' as reason, 1 as rank
        from task as t where t.created_by is not null
        union all
        select ta.task_id, ta.user_id, 'assignee', 2 from task_assignee as ta
        union all
        select a.task_id, a.user_id, 'commenter', 3
        from activity as a
        where a.type = 'comment' and a.user_id is not null
          and a.external_source is null
        union all
        select tm.task_id, tm.user_id, 'mention', 4 from task_mention as tm
      ) as src
      order by src.task_id, src.user_id, src.rank
    ) as pick
    on conflict do nothing
  `);
  return result.rowCount ?? 0;
}

/**
 * Idempotent boot safety net for B10 (§2.6), run after the task assignee
 * and task archive migrations (it needs task_assignee rows and
 * task.created_by). On a clean or migrated database it writes nothing; the
 * mention and subscription backfills run only while their table is empty,
 * because live writes keep both current afterwards. Publishes no events.
 */
export async function migrateNotificationInbox() {
  const workspaces = await backfillNotificationWorkspaces();
  const mentions = await backfillMentions();
  const subscriptions = await backfillSubscriptions();
  if (workspaces > 0 || mentions > 0 || subscriptions > 0) {
    console.log(
      `Notification inbox: workspaces ${workspaces}, mentions ${mentions}, subscriptions ${subscriptions}`,
    );
  }
  return { workspaces, mentions, subscriptions };
}
