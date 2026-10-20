import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import db from "../../database";
import { labelTable, taskTable } from "../../database/schema";

/**
 * Every label of the workspace. Labels on tasks of a restricted project the
 * caller may not see (`hidden`) are left out; workspace labels stay.
 */
function getLabelsByWorkspaceId(
  workspaceId: string,
  hidden: readonly string[] = [],
) {
  return db
    .select()
    .from(labelTable)
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        hidden.length === 0
          ? undefined
          : or(
              isNull(labelTable.taskId),
              notInArray(
                labelTable.taskId,
                db
                  .select({ id: taskTable.id })
                  .from(taskTable)
                  .where(inArray(taskTable.projectId, [...hidden])),
              ),
            ),
      ),
    );
}

export default getLabelsByWorkspaceId;
