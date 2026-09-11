import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { CREATABLE_COLUMN_GROUPS } from "../column/groups";
import {
  cycleTable,
  estimatePointTable,
  estimateTable,
  labelTable,
  moduleTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import type { TaskReadDatabase } from "../task/bounded-read";
import { VALID_PRIORITIES } from "../task/validate-task-fields";
import { type QueryContext, textArray } from "./context";
import {
  cycleColumns,
  type MetaStore,
  moduleColumns,
  pointColumns,
} from "./hydrate";
import { CURRENT_CYCLE } from "./keys/cycle";
import { LABEL_NAME_PREFIX } from "./keys/label";
import { type FilterNode, type GroupByKey, isFilterGroup } from "./schema";

// Empty groups (display.showEmptyGroups): the key's possible values that no
// matching task has yet, e.g. every priority. A root AND holding an `in`
// condition on the same key limits them to its values.

export const MAX_EMPTY_DOMAIN = 100;

type DomainEntry = { key: string; aliases: string[] };

/** Values of `in` conditions on `key` directly under a root AND. */
export function emptyGroupLimit(
  filters: FilterNode | null | undefined,
  key: GroupByKey,
  userId: string,
): Set<string> | null {
  if (!filters) return null;
  const nodes = isFilterGroup(filters)
    ? filters.op === "and"
      ? filters.children
      : []
    : [filters];
  let limit: Set<string> | null = null;
  for (const node of nodes) {
    if (isFilterGroup(node) || node.key !== key || node.operator !== "in") {
      continue;
    }
    const values = new Set(
      (node.values ?? []).map((value) => (value === "me" ? userId : value)),
    );
    // Several `in` conditions on the key, all AND-ed: their intersection.
    if (limit) {
      for (const value of limit) if (!values.has(value)) limit.delete(value);
    } else {
      limit = values;
    }
  }
  return limit;
}

async function domainEntries(
  tx: TaskReadDatabase,
  key: GroupByKey,
  context: QueryContext,
  store: MetaStore,
): Promise<DomainEntry[]> {
  const plain = (keys: readonly string[]) =>
    keys.map((value) => ({ key: value, aliases: [] }));
  switch (key) {
    case "status":
      return plain(
        (context.projects[0]?.columns ?? [])
          .filter((column) => column.group !== "triage")
          .map((column) => column.slug),
      );
    case "group":
      return plain(CREATABLE_COLUMN_GROUPS);
    case "priority":
      return plain(VALID_PRIORITIES);
    case "project":
      return plain(context.projectIds);
    case "createdBy":
      return [];
    case "assignee": {
      const members = await tx
        .select({
          id: userTable.id,
          name: userTable.name,
          image: userTable.image,
        })
        .from(workspaceUserTable)
        .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
        .where(eq(workspaceUserTable.workspaceId, context.workspaceId))
        .orderBy(asc(sql`lower(${userTable.name})`), asc(userTable.id))
        .limit(MAX_EMPTY_DOMAIN);
      store.addUsers(members);
      return plain(members.map((member) => member.id));
    }
    case "label": {
      const labels = await tx
        .select({ id: labelTable.id, name: labelTable.name })
        .from(labelTable)
        .where(
          and(
            eq(labelTable.workspaceId, context.workspaceId),
            isNull(labelTable.taskId),
          ),
        )
        .orderBy(asc(sql`lower(${labelTable.name})`), asc(labelTable.name))
        .limit(MAX_EMPTY_DOMAIN);
      return labels.map((label) => ({
        key: `${LABEL_NAME_PREFIX}${label.name}`,
        aliases: [label.id],
      }));
    }
    case "cycle": {
      const ids = context.featureProjectIds.cycles;
      if (ids.length === 0) return [];
      const rows = await tx
        .select(cycleColumns)
        .from(cycleTable)
        .where(
          and(
            sql`${cycleTable.projectId} = any(${textArray(ids)})`,
            isNull(cycleTable.archivedAt),
          ),
        );
      store.addCycles(rows);
      // Assignable cycles only: current, upcoming and draft.
      return rows
        .filter((row) => store.cycles.get(row.id)?.status !== "completed")
        .map((row) => ({
          key: row.id,
          aliases:
            store.cycles.get(row.id)?.status === "current"
              ? [CURRENT_CYCLE]
              : [],
        }));
    }
    case "module": {
      const ids = context.featureProjectIds.modules;
      if (ids.length === 0) return [];
      const rows = await tx
        .select(moduleColumns)
        .from(moduleTable)
        .where(
          and(
            sql`${moduleTable.projectId} = any(${textArray(ids)})`,
            isNull(moduleTable.archivedAt),
          ),
        )
        .orderBy(asc(moduleTable.position), asc(moduleTable.id))
        .limit(MAX_EMPTY_DOMAIN);
      store.addModules(rows);
      return plain(rows.map((row) => row.id));
    }
    case "estimate": {
      const ids = context.featureProjectIds.estimates;
      if (ids.length === 0) return [];
      const rows = await tx
        .select(pointColumns)
        .from(estimatePointTable)
        .innerJoin(
          estimateTable,
          eq(estimateTable.id, estimatePointTable.estimateId),
        )
        .where(
          and(
            sql`${estimateTable.projectId} = any(${textArray(ids)})`,
            eq(estimateTable.isActive, true),
          ),
        );
      store.addPoints(rows);
      return plain(rows.map((row) => row.id));
    }
  }
}

/** The key's empty-group candidates, limited by the filter's `in` values. */
export async function loadEmptyDomain(
  tx: TaskReadDatabase,
  key: GroupByKey,
  context: QueryContext,
  store: MetaStore,
  limit: ReadonlySet<string> | null,
): Promise<string[]> {
  const entries = await domainEntries(tx, key, context, store);
  return entries
    .filter(
      (entry) =>
        !limit ||
        limit.has(entry.key) ||
        entry.aliases.some((alias) => limit.has(alias)),
    )
    .slice(0, MAX_EMPTY_DOMAIN)
    .map((entry) => entry.key);
}
