import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  columnTable,
  customFieldDefinitionTable,
  cycleTable,
  estimatePointTable,
  estimateTable,
  labelTable,
  moduleTable,
  projectTable,
  taskTable,
} from "../database/schema";
import { ME_TOKEN, NONE_TOKEN } from "../task-query/compile";
import { CURRENT_CYCLE } from "../task-query/keys/cycle";
import { LABEL_NAME_PREFIX } from "../task-query/keys/label";
import type { FilterNode } from "../task-query/schema";
import { filterConditions } from "../task-query/validate";
import { filterAssignableUsers } from "../utils/assert-assignable-user";

// Saving a view is strict (B4 §5.4): every id a condition names must exist in
// the view's workspace, and in a project view, cycles, modules, estimate
// points, custom fields and statuses must belong to that project. Running a
// query stays lenient instead, so a stale view still loads.

/** Keys whose values name other rows, with the noun used in errors. */
const REFERENCE_NOUNS: Record<string, string> = {
  assignee: "assignee",
  createdBy: "creator",
  subscriber: "subscriber",
  mention: "user",
  status: "status",
  label: "label",
  cycle: "cycle",
  module: "module",
  estimate: "estimate",
  project: "project",
  parent: "parent task",
  customField: "custom field",
};

const USER_KEYS = ["assignee", "createdBy", "subscriber", "mention"];

function isToken(key: string, value: string): boolean {
  if (value === NONE_TOKEN || value === ME_TOKEN) return true;
  if (key === "cycle") return value === CURRENT_CYCLE;
  if (key === "status") return value === "planned";
  if (key === "label") return value.startsWith(LABEL_NAME_PREFIX);
  return false;
}

/** Key to the ids its conditions name; custom field ids under customField. */
export function referencedIds(root: FilterNode | null): Map<string, string[]> {
  const ids = new Map<string, Set<string>>();
  const add = (key: string, value: string) => {
    const set = ids.get(key) ?? new Set<string>();
    set.add(value);
    ids.set(key, set);
  };
  for (const condition of filterConditions(root)) {
    if (condition.key === "customField") {
      if (condition.fieldId) add("customField", condition.fieldId);
      continue;
    }
    if (!(condition.key in REFERENCE_NOUNS)) continue;
    for (const value of condition.values ?? []) {
      if (!isToken(condition.key, value)) add(condition.key, value);
    }
  }
  return new Map([...ids].map(([key, set]) => [key, [...set]]));
}

function unknownReference(key: string): never {
  throw new HTTPException(400, {
    message: `Filter references an unknown ${REFERENCE_NOUNS[key] ?? key}`,
  });
}

type Scope = { workspaceId: string; projectId: string | null };

/** In a project view, project-owned rows must be of that project. */
function projectCondition(column: AnyPgColumn, scope: Scope): SQL | undefined {
  return scope.projectId ? eq(column, scope.projectId) : undefined;
}

async function existingIds(
  key: string,
  ids: string[],
  scope: Scope,
): Promise<Set<string>> {
  const found = (rows: { id: string }[]) => new Set(rows.map((row) => row.id));
  const inWorkspace = eq(projectTable.workspaceId, scope.workspaceId);
  switch (key) {
    case "status":
      // Workspace views can't filter by status (validate.ts).
      return found(
        await db
          .select({ id: columnTable.slug })
          .from(columnTable)
          .where(
            and(
              eq(columnTable.projectId, scope.projectId ?? ""),
              inArray(columnTable.slug, ids),
            ),
          ),
      );
    case "label":
      return found(
        await db
          .select({ id: labelTable.id })
          .from(labelTable)
          .where(
            and(
              inArray(labelTable.id, ids),
              eq(labelTable.workspaceId, scope.workspaceId),
              isNull(labelTable.taskId),
            ),
          ),
      );
    case "cycle":
      return found(
        await db
          .select({ id: cycleTable.id })
          .from(cycleTable)
          .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
          .where(
            and(
              inArray(cycleTable.id, ids),
              inWorkspace,
              projectCondition(cycleTable.projectId, scope),
            ),
          ),
      );
    case "module":
      return found(
        await db
          .select({ id: moduleTable.id })
          .from(moduleTable)
          .innerJoin(projectTable, eq(projectTable.id, moduleTable.projectId))
          .where(
            and(
              inArray(moduleTable.id, ids),
              inWorkspace,
              projectCondition(moduleTable.projectId, scope),
            ),
          ),
      );
    case "estimate":
      return found(
        await db
          .select({ id: estimatePointTable.id })
          .from(estimatePointTable)
          .innerJoin(
            estimateTable,
            eq(estimateTable.id, estimatePointTable.estimateId),
          )
          .innerJoin(projectTable, eq(projectTable.id, estimateTable.projectId))
          .where(
            and(
              inArray(estimatePointTable.id, ids),
              inWorkspace,
              projectCondition(estimateTable.projectId, scope),
            ),
          ),
      );
    case "customField":
      return found(
        await db
          .select({ id: customFieldDefinitionTable.id })
          .from(customFieldDefinitionTable)
          .innerJoin(
            projectTable,
            eq(projectTable.id, customFieldDefinitionTable.projectId),
          )
          .where(
            and(
              inArray(customFieldDefinitionTable.id, ids),
              inWorkspace,
              projectCondition(customFieldDefinitionTable.projectId, scope),
            ),
          ),
      );
    case "project":
      return found(
        await db
          .select({ id: projectTable.id })
          .from(projectTable)
          .where(and(inArray(projectTable.id, ids), inWorkspace)),
      );
    case "parent":
      return found(
        await db
          .select({ id: taskTable.id })
          .from(taskTable)
          .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
          .where(and(inArray(taskTable.id, ids), inWorkspace)),
      );
    default:
      if (USER_KEYS.includes(key)) {
        return filterAssignableUsers(ids, scope.workspaceId);
      }
      return new Set(ids);
  }
}

/**
 * Throws 400 "Filter references an unknown …" for the first condition value
 * (or custom field column) that names a row outside the view's scope.
 */
export async function assertViewReferences(
  scope: Scope,
  {
    root,
    customFieldColumns = [],
  }: { root?: FilterNode | null; customFieldColumns?: string[] },
): Promise<void> {
  for (const [key, ids] of referencedIds(root ?? null)) {
    const existing = await existingIds(key, ids, scope);
    if (ids.some((id) => !existing.has(id))) unknownReference(key);
  }
  if (customFieldColumns.length > 0) {
    const existing = await existingIds(
      "customField",
      customFieldColumns,
      scope,
    );
    if (customFieldColumns.some((id) => !existing.has(id))) {
      throw new HTTPException(400, {
        message: "Display properties reference an unknown custom field",
      });
    }
  }
}
