import { inArray, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { labelTable, taskTable } from "../../database/schema";
import type { SetFilterKey } from "./registry";

// Label copies live on the task and share names, not ids, with the workspace
// label (B0 C6). Conditions store workspace label ids, resolved to their
// current names at query time, so a rename keeps matching; names without a
// workspace label are stored as `name:<label name>`.

export const LABEL_NAME_PREFIX = "name:";

const COPY_ALIAS = "task_label_filter";
const WORKSPACE_ALIAS = "workspace_label_filter";
const copy = alias(labelTable, COPY_ALIAS);
const workspaceLabel = alias(labelTable, WORKSPACE_ALIAS);

export function splitLabelValues(values: readonly string[]) {
  const names: string[] = [];
  const ids: string[] = [];
  for (const value of values) {
    if (value.startsWith(LABEL_NAME_PREFIX)) {
      names.push(value.slice(LABEL_NAME_PREFIX.length));
    } else {
      ids.push(value);
    }
  }
  return { names, ids };
}

function copyExists(condition?: SQL): SQL {
  return sql`exists (
    select 1 from ${labelTable} as ${sql.identifier(COPY_ALIAS)}
    where ${copy.taskId} = ${taskTable.id}${condition ? sql` and (${condition})` : sql``}
  )`;
}

export const labelKey: SetFilterKey = {
  key: "label",
  kind: "set",
  matchAny(values, context) {
    const { names, ids } = splitLabelValues(values);
    const byName: SQL[] = [];
    if (names.length > 0) byName.push(inArray(copy.name, names));
    if (ids.length > 0) {
      // Only this workspace's labels (rows without a task) resolve.
      byName.push(sql`${copy.name} in (
        select ${workspaceLabel.name} from ${labelTable} as ${sql.identifier(WORKSPACE_ALIAS)}
        where ${inArray(workspaceLabel.id, ids)}
          and ${workspaceLabel.workspaceId} = ${context.workspaceId}
          and ${workspaceLabel.taskId} is null
      )`);
    }
    return copyExists(or(...byName));
  },
  isEmpty: () => sql`not ${copyExists()}`,
};
