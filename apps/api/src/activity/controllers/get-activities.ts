import { desc, eq } from "drizzle-orm";
import db from "../../database";
import { activityTable } from "../../database/schema";
import { redactActivityRows } from "../../task-activity/redact";

async function getActivitiesFromTaskId(
  taskId: string,
  reader: {
    workspaceId: string;
    /** Projects the reader may not see (project/visibility.ts). */
    hidden: readonly string[];
  },
) {
  const activities = await db.query.activityTable.findMany({
    where: eq(activityTable.taskId, taskId),
    orderBy: [desc(activityTable.createdAt)],
  });

  activities.forEach((x) => {
    if (x.content && x.type !== "comment") {
      x.content = x.content.replace(/\n+/g, "\n");
    }
  });

  return redactActivityRows(activities, {
    workspaceIds: [reader.workspaceId],
    hidden: reader.hidden,
  });
}

export default getActivitiesFromTaskId;
