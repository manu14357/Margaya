import { createId } from "@paralleldrive/cuid2";
import { desc, eq, sql } from "drizzle-orm";
import { withAutomationMarker } from "../automation-rule/context";
import db from "../database";
import { activityTable, taskTable, userTable } from "../database/schema";
import { decideDescriptionActivity } from "./coalesce";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Writer = Pick<Transaction, "execute">;

/**
 * One activity row, written only while the task still exists: an event about
 * a task deleted meanwhile writes nothing and logs nothing. A user deleted
 * meanwhile leaves the row unattributed, like the FK's set null does.
 */
export async function insertTaskActivity(
  {
    taskId,
    type,
    userId,
    eventData,
  }: {
    taskId: string;
    type: string;
    /** Null for system rows, such as intake's snooze wake-up. */
    userId: string | null;
    eventData: Record<string, unknown>;
  },
  writer: Writer = db,
) {
  await writer.execute(sql`
    insert into ${activityTable} (id, task_id, type, user_id, content, event_data)
    select ${createId()}, ${taskId}, ${type},
      (select ${userTable.id} from ${userTable} where ${userTable.id} = ${userId}),
      null, ${JSON.stringify(withAutomationMarker(eventData))}::jsonb
    where exists (select 1 from ${taskTable} where ${taskTable.id} = ${taskId})
  `);
}

/**
 * Records a description save, folding it into this person's previous save
 * when that is the task's newest row and less than ten minutes old. Ages and
 * bumps use the database clock, like the rows' defaults. Two racing saves
 * may both insert; that is acceptable.
 */
export async function recordDescriptionEdit(taskId: string, userId: string) {
  await db.transaction(async (tx) => {
    const [newest] = await tx
      .select({
        id: activityTable.id,
        type: activityTable.type,
        userId: activityTable.userId,
        ageMs:
          sql<number>`extract(epoch from (localtimestamp - ${activityTable.createdAt})) * 1000`.mapWith(
            Number,
          ),
      })
      .from(activityTable)
      .where(eq(activityTable.taskId, taskId))
      .orderBy(desc(activityTable.createdAt), desc(activityTable.id))
      .limit(1);

    const decision = decideDescriptionActivity(newest, userId);
    if (decision.action === "update") {
      await tx
        .update(activityTable)
        .set({
          createdAt: sql`localtimestamp`,
          updatedAt: sql`localtimestamp`,
        })
        .where(eq(activityTable.id, decision.activityId));
      return;
    }
    await insertTaskActivity(
      { taskId, type: "description_changed", userId, eventData: {} },
      tx,
    );
  });
}
