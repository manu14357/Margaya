import { and, eq, gte, sql } from "drizzle-orm";
import { OPEN_COLUMN_GROUPS } from "../../column/groups";
import {
  columnTable,
  taskAssigneeTable,
  taskTable,
} from "../../database/schema";
import { taskColumnJoin, taskGroupSql } from "../../task/scope";
import { ChartMeta } from "../meta";
import { loadPointsProjectIds, weightSql } from "../metrics";
import type { AnalyticsWorkload } from "../response";
import {
  type AnalyticsCaller,
  analyticsRead,
  loadAnalyticsContext,
  taskSetCondition,
} from "../scope";
import {
  buildWorkload,
  type DoneRow,
  type OpenRow,
  WORKLOAD_HISTORY_DAYS,
  WORKLOAD_USUAL_DAYS,
} from "../workload-math";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Open work per assignee over the scope projects the caller can see, each
 * person against what they finished there recently. The comparison is an
 * analytics read like the rest: the same audience (analytics:read) and the
 * same visible scope, which a per-assignee chart of completed work already
 * shows. The history keeps archived tasks: finishing a task and archiving it
 * later is still work done. Bounded like every analytics read.
 */
export async function getAnalyticsWorkload(
  caller: AnalyticsCaller,
  {
    projectIds,
    timeZone,
    now = new Date(),
  }: {
    projectIds?: string[];
    timeZone?: string;
    now?: Date;
  },
): Promise<AnalyticsWorkload> {
  return analyticsRead(async (tx) => {
    const context = await loadAnalyticsContext(tx, caller, {
      projectIds,
      timeZone,
    });
    const weight = weightSql("estimatePoints", context);
    const openGroups = sql.join(
      OPEN_COLUMN_GROUPS.map((group) => sql`${group}`),
      sql`, `,
    );

    const { rows: open } = await tx.execute<OpenRow>(sql`
      select user_id as "userId", grp as "group", count(*)::int as tasks,
        coalesce(sum(weight), 0)::float8 as points,
        (count(*) filter (where weight > 0))::int as sized
      from (
        select ${taskAssigneeTable.userId} as user_id, ${taskGroupSql} as grp,
          ${weight} as weight
        from ${taskTable}
        left join ${columnTable} on ${taskColumnJoin}
        left join ${taskAssigneeTable} on ${eq(taskAssigneeTable.taskId, taskTable.id)}
        where ${taskSetCondition(context)} and ${taskGroupSql} in (${openGroups})
      ) as scoped
      group by user_id, grp`);

    const since = new Date(now.getTime() - WORKLOAD_HISTORY_DAYS * DAY_MS);
    const { rows: done } = await tx.execute<DoneRow>(sql`
      select ${taskAssigneeTable.userId} as "userId", count(*)::int as tasks,
        coalesce(sum(${weight}), 0)::float8 as points
      from ${taskTable}
      left join ${columnTable} on ${taskColumnJoin}
      inner join ${taskAssigneeTable} on ${eq(taskAssigneeTable.taskId, taskTable.id)}
      where ${and(
        taskSetCondition(context, { archived: "include" }),
        sql`${taskGroupSql} = 'completed'`,
        gte(taskTable.completedAt, since),
      )}
      group by ${taskAssigneeTable.userId}`);

    const pointsProjectIds = await loadPointsProjectIds(tx, context);
    const workload = buildWorkload({
      open,
      done,
      pointsAvailable: pointsProjectIds.length > 0,
      includeCheck: true,
    });

    const keys = workload.members.flatMap((member) =>
      member.userId ? [member.userId] : [],
    );
    const entries = [{ dimension: "assignee" as const, keys }];
    const meta = new ChartMeta(tx, context);
    await meta.load(entries);
    return {
      ...workload,
      usualDays: WORKLOAD_USUAL_DAYS,
      historyDays: WORKLOAD_HISTORY_DAYS,
      meta: { users: meta.build(entries).users },
    };
  });
}
