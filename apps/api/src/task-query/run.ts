import { type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { columnTable, taskTable } from "../database/schema";
import { boundedTaskRead, type TaskReadDatabase } from "../task/bounded-read";
import { taskColumnJoin } from "../task/scope";
import { compileTaskScope } from "./compile";
import { buildQueryContext, type QueryContext, textArray } from "./context";
import { decodeCursor, encodeCursor, queryHash, STALE_RESULTS } from "./cursor";
import type { WeekStart } from "./dates";
import { emptyGroupLimit, loadEmptyDomain } from "./domains";
import {
  ALL_GROUP,
  type GroupKeyExpression,
  groupKeyExpression,
  NONE_GROUP,
  sortGroupKeys,
  USER_GROUP_KEYS,
} from "./group";
import { hydrateRows, MetaStore, type TaskQueryRow } from "./hydrate";
import { type FilterKeyRegistry, filterKeyRegistry } from "./keys";
import { LABEL_NAME_PREFIX } from "./keys/label";
import { buildMeta, type TaskQueryMeta } from "./meta";
import { orderByItems, type ResolvedOrder, resolveOrder } from "./order";
import {
  type ArchivedFilter,
  customFieldIdOfKey,
  DEFAULT_ROWS_PER_GROUP,
  type FilterNode,
  type GroupByKey,
  isCustomFieldDisplayKey,
  type TaskQueryInclude,
  type TaskQueryMode,
  type TaskQueryRequest,
} from "./schema";
import { filterConditions, validateFilterTree } from "./validate";

// The query plan (B4 §3.2), inside one bounded read: context, compile, group
// counts, the page, hydration and meta. The statement count is fixed by the
// request's shape, never by the page size or the number of groups.

export const TASK_QUERY_TIMEOUT =
  "Task query took too long; narrow the filters and retry";
export const GROUP_BY_STATUS_NEEDS_ONE_PROJECT =
  "Group by status needs a single project";
export const GROUPS_MUST_DIFFER = "Group and sub-group must differ";

/** ids mode returns at most this many ids; above it, none and truncated. */
export const MAX_QUERY_IDS = 20_000;
export const MAX_GROUPS_WITH_ROWS = 100;
export const MAX_SUB_GROUPS_WITH_ROWS = 30;

export type TaskQueryCaller = {
  workspaceId: string;
  userId: string;
  /** A public board (B12): no caller, no personal keys, no user meta. */
  publicContext?: boolean;
};

export type TaskQuerySubGroup = {
  key: string;
  count: number;
  taskIds?: string[];
  nextCursor: string | null;
};

export type TaskQueryGroup = TaskQuerySubGroup & {
  subGroups?: TaskQuerySubGroup[];
};

export type TaskQueryResult = {
  mode: TaskQueryMode;
  groupBy: GroupByKey | null;
  subGroupBy: GroupByKey | null;
  today: string;
  totalCount: number;
  groups: TaskQueryGroup[];
  hasMoreGroups: boolean;
  tasks: Record<string, TaskQueryRow>;
  meta: TaskQueryMeta;
  ids?: string[];
  truncated?: boolean;
};

/** The request with every default applied; its page-less part is hashed. */
export type NormalizedTaskQuery = {
  workspaceId: string;
  projectIds: string[] | null;
  filters: FilterNode | null;
  archived: ArchivedFilter;
  search: string | null;
  groupBy: GroupByKey | null;
  subGroupBy: GroupByKey | null;
  order: ResolvedOrder;
  showSubTasks: boolean;
  showEmptyGroups: boolean;
  include: TaskQueryInclude[];
  mode: TaskQueryMode;
  timeZone: string;
  weekStartsOn: WeekStart;
};

type PageRequest = {
  limit: number;
  group?: string;
  subGroup?: string;
  cursor?: string;
};

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

export function normalizeTaskQuery(
  request: TaskQueryRequest,
): NormalizedTaskQuery {
  const mode = request.mode ?? "rows";
  const display = request.display ?? {};
  const projectIds = request.scope?.projectIds
    ? [...new Set(request.scope.projectIds)]
    : null;
  // ids mode ignores grouping entirely.
  const groupBy = mode === "ids" ? null : (display.groupBy ?? null);
  const subGroupBy = mode === "ids" ? null : (display.subGroupBy ?? null);
  if (subGroupBy && (!groupBy || subGroupBy === groupBy)) {
    badRequest(GROUPS_MUST_DIFFER);
  }
  return {
    workspaceId: request.workspaceId,
    projectIds,
    filters: request.filters ?? null,
    archived: request.archived ?? "exclude",
    search: request.search?.trim() || null,
    groupBy,
    subGroupBy,
    order: resolveOrder(display.orderBy, projectIds !== null),
    showSubTasks: display.showSubTasks ?? true,
    showEmptyGroups: display.showEmptyGroups ?? false,
    include: [...new Set(request.include ?? [])].sort(),
    mode,
    timeZone: request.context?.timeZone ?? "UTC",
    weekStartsOn: request.context?.weekStartsOn ?? 0,
  };
}

// --- statements ---------------------------------------------------------

type GroupedFrom = { from: SQL; g1: SQL | null; g2: SQL | null };

const GROUP_KEY_ALIASES = ["group_key_1", "group_key_2"] as const;

/** FROM task, its column, and one lateral fan-out per many-valued key. */
function taskFrom(
  g1: GroupKeyExpression | null,
  g2: GroupKeyExpression | null,
): GroupedFrom {
  const parts: SQL[] = [
    sql`from ${taskTable} left join ${columnTable} on ${taskColumnJoin}`,
  ];
  const refs = [g1, g2].map((expression, index) => {
    if (!expression) return null;
    if (!expression.many) return expression.sql;
    const alias = sql.identifier(GROUP_KEY_ALIASES[index] ?? "group_key");
    parts.push(
      sql`cross join lateral unnest(coalesce(nullif(${expression.sql}, '{}'::text[]), array[${NONE_GROUP}::text])) as ${alias}(${sql.identifier("key")})`,
    );
    return sql`${alias}.${sql.identifier("key")}`;
  });
  return {
    from: sql.join(parts, sql` `),
    g1: refs[0] ?? null,
    g2: refs[1] ?? null,
  };
}

type CountRow = {
  g1: string | null;
  g2: string | null;
  n: number;
  ga: number;
  gb: number;
};

type GroupCounts = {
  total: number;
  groups: Map<string, number>;
  cells: Map<string, Map<string, number>>;
};

async function countGroups(
  tx: TaskReadDatabase,
  from: GroupedFrom,
  condition: SQL,
): Promise<GroupCounts> {
  const keyed = sql`select ${taskTable.id} as id, ${from.g1} as g1, ${from.g2 ?? sql`null::text`} as g2 ${from.from} where ${condition}`;
  const statement = from.g2
    ? sql`select g1, g2, count(distinct id)::int as n, grouping(g1)::int as ga, grouping(g2)::int as gb
        from (${keyed}) as keyed group by grouping sets ((), (g1), (g1, g2))`
    : sql`select g1, null::text as g2, count(distinct id)::int as n, grouping(g1)::int as ga, 1 as gb
        from (${keyed}) as keyed group by grouping sets ((), (g1))`;
  const { rows } = await tx.execute<CountRow>(statement);
  const counts: GroupCounts = { total: 0, groups: new Map(), cells: new Map() };
  for (const row of rows) {
    const n = Number(row.n);
    if (Number(row.ga) === 1) counts.total = n;
    else if (Number(row.gb) === 1) counts.groups.set(row.g1 ?? NONE_GROUP, n);
    else {
      const group = row.g1 ?? NONE_GROUP;
      const cells = counts.cells.get(group) ?? new Map<string, number>();
      cells.set(row.g2 ?? NONE_GROUP, n);
      counts.cells.set(group, cells);
    }
  }
  return counts;
}

type PageTarget =
  | { kind: "all" }
  | { kind: "groups"; groups: string[] }
  | { kind: "cells"; cells: Array<[string, string]> }
  | { kind: "group"; group: string }
  | { kind: "cell"; group: string; subGroup: string };

type PageRow = { id: string; g1: string; g2: string | null };

async function pageRows(
  tx: TaskReadDatabase,
  from: GroupedFrom,
  condition: SQL,
  orderSql: SQL,
  target: PageTarget,
  offset: number,
  limit: number,
): Promise<PageRow[]> {
  const g1 = from.g1 as SQL;
  let restriction: SQL | null = null;
  if (target.kind === "groups") {
    restriction = sql`${g1} = any(${textArray(target.groups)})`;
  } else if (target.kind === "cells") {
    restriction = sql`(${g1}, ${from.g2}) in (select * from unnest(${textArray(target.cells.map(([group]) => group))}, ${textArray(target.cells.map(([, cell]) => cell))}))`;
  } else if (target.kind === "group") {
    restriction = sql`${g1} = ${target.group}`;
  } else if (target.kind === "cell") {
    restriction = sql`${g1} = ${target.group} and ${from.g2} = ${target.subGroup}`;
  }
  const partition = from.g2 ? sql`${g1}, ${from.g2}` : g1;
  const numbered = sql`select ${taskTable.id} as id, ${g1} as g1, ${from.g2 ?? sql`null::text`} as g2,
      row_number() over (partition by ${partition} order by ${orderSql}) as rn
    ${from.from}
    where ${condition}${restriction ? sql` and ${restriction}` : sql``}`;
  const { rows } = await tx.execute<PageRow>(
    sql`select id, g1, g2 from (${numbered}) as numbered
      where rn > ${offset} and rn <= ${offset + limit}
      order by g1, g2, rn`,
  );
  return rows;
}

// --- plan ------------------------------------------------------------------

function groupKeysOf(
  key: GroupByKey | null,
  values: Iterable<string>,
): string[] {
  if (!key) return [];
  return [...values].filter((value) => value !== NONE_GROUP);
}

/** Loads what ordering a key's groups needs (users, cycles, ...). */
async function loadGroupMeta(
  store: MetaStore,
  key: GroupByKey | null,
  values: Iterable<string>,
): Promise<void> {
  const keys = groupKeysOf(key, values);
  if (key === "assignee" || key === "createdBy") await store.loadUsers(keys);
  else if (key === "cycle") await store.loadCycles(keys);
  else if (key === "module") await store.loadModules(keys);
  else if (key === "estimate") await store.loadPoints(keys);
  else if (key === "label") await store.loadLabels(keys, LABEL_NAME_PREFIX);
}

type Plan = {
  query: NormalizedTaskQuery;
  context: QueryContext;
  condition: SQL;
  store: MetaStore;
  page: PageRequest;
  hash: (group: string, subGroup: string | null) => string;
};

function readCursor(plan: Plan, group: string, subGroup: string | null) {
  const cursor = plan.page.cursor;
  if (!cursor) return 0;
  const offset = decodeCursor(cursor, plan.hash(group, subGroup));
  if (offset === null) badRequest(STALE_RESULTS);
  return offset;
}

function nextCursorOf(
  plan: Plan,
  group: string,
  subGroup: string | null,
  offset: number,
  delivered: number,
  count: number,
): string | null {
  const next = offset + delivered;
  return next < count ? encodeCursor(next, plan.hash(group, subGroup)) : null;
}

async function finish(
  tx: TaskReadDatabase,
  plan: Plan,
  base: Omit<TaskQueryResult, "tasks" | "meta" | "today" | "mode">,
  taskIds: string[],
): Promise<TaskQueryResult> {
  const { query, context, store } = plan;
  const include = new Set(query.include);
  const rows = await hydrateRows(tx, context, taskIds, include);
  const tasks: Record<string, TaskQueryRow> = {};
  for (const id of taskIds) {
    const row = rows.get(id);
    if (row) tasks[id] = row;
  }
  const meta = await buildMeta(store, {
    rows: Object.values(tasks),
    groupBy: base.groupBy,
    subGroupBy: base.subGroupBy,
    groups: base.groups,
    includeCustomFields: include.has("customFields"),
  });
  return { mode: query.mode, today: context.today, ...base, tasks, meta };
}

async function runUngrouped(
  tx: TaskReadDatabase,
  plan: Plan,
): Promise<TaskQueryResult> {
  const { query, condition, page } = plan;
  if ((page.group && page.group !== ALL_GROUP) || page.subGroup) {
    badRequest(STALE_RESULTS);
  }
  const offset = readCursor(plan, ALL_GROUP, null);
  const from = taskFrom(null, null);
  const {
    rows: [total],
  } = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n ${from.from} where ${condition}`,
  );
  const count = Number(total?.n ?? 0);
  const base = {
    groupBy: null,
    subGroupBy: null,
    totalCount: count,
    hasMoreGroups: false,
  };
  if (query.mode === "counts") {
    return finish(
      tx,
      plan,
      { ...base, groups: [{ key: ALL_GROUP, count, nextCursor: null }] },
      [],
    );
  }
  const { rows } = await tx.execute<{ id: string }>(
    sql`select ${taskTable.id} as id ${from.from} where ${condition}
      order by ${orderByItems(query.order, plan.context)}
      limit ${page.limit} offset ${offset}`,
  );
  const taskIds = rows.map((row) => row.id);
  return finish(
    tx,
    plan,
    {
      ...base,
      groups: [
        {
          key: ALL_GROUP,
          count,
          taskIds,
          nextCursor: nextCursorOf(
            plan,
            ALL_GROUP,
            null,
            offset,
            taskIds.length,
            count,
          ),
        },
      ],
    },
    taskIds,
  );
}

async function runGrouped(
  tx: TaskReadDatabase,
  plan: Plan,
  groupBy: GroupByKey,
): Promise<TaskQueryResult> {
  const { query, context, condition, store, page } = plan;
  const subGroupBy = query.subGroupBy;
  const from = taskFrom(
    groupKeyExpression(groupBy, context),
    subGroupBy ? groupKeyExpression(subGroupBy, context) : null,
  );
  const counts = await countGroups(tx, from, condition);

  // Every group (and cell) key, with the empty ones when asked for.
  const groupCounts = new Map(counts.groups);
  const cellCounts = new Map(
    [...counts.cells].map(([key, cells]) => [key, new Map(cells)]),
  );
  if (query.showEmptyGroups) {
    const domain = await loadEmptyDomain(
      tx,
      groupBy,
      context,
      store,
      emptyGroupLimit(query.filters, groupBy, context.userId),
    );
    for (const key of domain) {
      if (!groupCounts.has(key)) groupCounts.set(key, 0);
    }
    if (subGroupBy) {
      const subDomain = await loadEmptyDomain(
        tx,
        subGroupBy,
        context,
        store,
        emptyGroupLimit(query.filters, subGroupBy, context.userId),
      );
      for (const group of groupCounts.keys()) {
        const cells = cellCounts.get(group) ?? new Map<string, number>();
        for (const key of subDomain) if (!cells.has(key)) cells.set(key, 0);
        cellCounts.set(group, cells);
      }
    }
  }

  await loadGroupMeta(store, groupBy, groupCounts.keys());
  if (subGroupBy) {
    await loadGroupMeta(
      store,
      subGroupBy,
      [...cellCounts.values()].flatMap((cells) => [...cells.keys()]),
    );
  }

  const orderedGroups = sortGroupKeys(groupBy, [...groupCounts.keys()], store);
  const orderedCells = new Map(
    orderedGroups.map((group) => [
      group,
      subGroupBy
        ? sortGroupKeys(
            subGroupBy,
            [...(cellCounts.get(group)?.keys() ?? [])],
            store,
          )
        : [],
    ]),
  );

  // One group (or cell) when loading more; otherwise the first 100 groups
  // (30 cells each) carry rows and the rest only counts.
  let target: PageTarget;
  let offset = 0;
  let responseGroups = orderedGroups;
  if (page.group) {
    if (!groupCounts.has(page.group)) badRequest(STALE_RESULTS);
    if (page.subGroup) {
      if (!subGroupBy || !cellCounts.get(page.group)?.has(page.subGroup)) {
        badRequest(STALE_RESULTS);
      }
      target = { kind: "cell", group: page.group, subGroup: page.subGroup };
    } else {
      if (subGroupBy) badRequest(STALE_RESULTS);
      target = { kind: "group", group: page.group };
    }
    offset = readCursor(plan, page.group, page.subGroup ?? null);
    responseGroups = [page.group];
  } else {
    if (page.cursor || page.subGroup) badRequest(STALE_RESULTS);
    const withRows = orderedGroups.slice(0, MAX_GROUPS_WITH_ROWS);
    if (!subGroupBy) {
      target =
        withRows.length < orderedGroups.length
          ? { kind: "groups", groups: withRows }
          : { kind: "all" };
    } else {
      const cells: Array<[string, string]> = [];
      let capped = withRows.length < orderedGroups.length;
      for (const group of withRows) {
        const keys = orderedCells.get(group) ?? [];
        if (keys.length > MAX_SUB_GROUPS_WITH_ROWS) capped = true;
        for (const key of keys.slice(0, MAX_SUB_GROUPS_WITH_ROWS)) {
          cells.push([group, key]);
        }
      }
      target = capped ? { kind: "cells", cells } : { kind: "all" };
    }
  }

  const hasMoreGroups =
    !page.group && orderedGroups.length > MAX_GROUPS_WITH_ROWS;
  const withRows = new Set(
    page.group ? [page.group] : orderedGroups.slice(0, MAX_GROUPS_WITH_ROWS),
  );

  if (query.mode === "counts") {
    const groups = responseGroups.map((group) => ({
      key: group,
      count: groupCounts.get(group) ?? 0,
      nextCursor: null,
      ...(subGroupBy
        ? {
            subGroups: (orderedCells.get(group) ?? []).map((key) => ({
              key,
              count: cellCounts.get(group)?.get(key) ?? 0,
              nextCursor: null,
            })),
          }
        : {}),
    }));
    return finish(
      tx,
      plan,
      { groupBy, subGroupBy, totalCount: counts.total, groups, hasMoreGroups },
      [],
    );
  }

  const rows = await pageRows(
    tx,
    from,
    condition,
    orderByItems(query.order, context),
    target,
    offset,
    page.limit,
  );
  const idsByCell = new Map<string, string[]>();
  const cellId = (group: string, key: string | null) =>
    `${group}\u0000${key ?? ""}`;
  const taskIds: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = cellId(row.g1, subGroupBy ? row.g2 : null);
    const list = idsByCell.get(id) ?? [];
    list.push(row.id);
    idsByCell.set(id, list);
    if (!seen.has(row.id)) {
      seen.add(row.id);
      taskIds.push(row.id);
    }
  }

  const cellSlice = (group: string, key: string | null, count: number) => {
    const ids = idsByCell.get(cellId(group, key)) ?? [];
    return {
      taskIds: ids,
      nextCursor: nextCursorOf(plan, group, key, offset, ids.length, count),
    };
  };

  const groups: TaskQueryGroup[] = responseGroups.map((group) => {
    const count = groupCounts.get(group) ?? 0;
    const carriesRows = withRows.has(group);
    if (!subGroupBy) {
      return carriesRows
        ? { key: group, count, ...cellSlice(group, null, count) }
        : { key: group, count, taskIds: [], nextCursor: null };
    }
    const keys = page.subGroup
      ? [page.subGroup]
      : (orderedCells.get(group) ?? []);
    return {
      key: group,
      count,
      taskIds: [],
      nextCursor: null,
      subGroups: keys.map((key, index) => {
        const cellCount = cellCounts.get(group)?.get(key) ?? 0;
        return carriesRows &&
          (page.subGroup || index < MAX_SUB_GROUPS_WITH_ROWS)
          ? { key, count: cellCount, ...cellSlice(group, key, cellCount) }
          : { key, count: cellCount, taskIds: [], nextCursor: null };
      }),
    };
  });

  return finish(
    tx,
    plan,
    { groupBy, subGroupBy, totalCount: counts.total, groups, hasMoreGroups },
    taskIds,
  );
}

async function runIds(
  tx: TaskReadDatabase,
  plan: Plan,
): Promise<TaskQueryResult> {
  const from = taskFrom(null, null);
  const { rows } = await tx.execute<{ id: string }>(
    sql`select ${taskTable.id} as id ${from.from} where ${plan.condition} limit ${MAX_QUERY_IDS + 1}`,
  );
  const truncated = rows.length > MAX_QUERY_IDS;
  let totalCount = rows.length;
  if (truncated) {
    const {
      rows: [total],
    } = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n ${from.from} where ${plan.condition}`,
    );
    totalCount = Number(total?.n ?? 0);
  }
  return {
    mode: "ids",
    groupBy: null,
    subGroupBy: null,
    today: plan.context.today,
    totalCount,
    groups: [],
    hasMoreGroups: false,
    tasks: {},
    meta: emptyMeta(),
    ids: truncated ? [] : rows.map((row) => row.id),
    truncated,
  };
}

export function emptyMeta(): TaskQueryMeta {
  return {
    users: [],
    projects: [],
    columns: [],
    labels: [],
    cycles: [],
    modules: [],
    estimatePoints: [],
    customFields: [],
  };
}

/**
 * Runs a task query for a caller that already passed workspace access and
 * `task:read`. Throws 400 for requests the engine cannot run, 404 for a
 * project outside the workspace and 503 on the statement timeout.
 */
export async function runTaskQuery(
  request: TaskQueryRequest,
  caller: TaskQueryCaller,
  { registry = filterKeyRegistry }: { registry?: FilterKeyRegistry } = {},
): Promise<TaskQueryResult> {
  validateFilterTree(request.filters, registry);
  const query = normalizeTaskQuery(request);
  const publicContext = caller.publicContext ?? false;
  if (
    publicContext &&
    [query.groupBy, query.subGroupBy].some(
      (key) => key && USER_GROUP_KEYS.includes(key),
    )
  ) {
    badRequest(`Unsupported group: ${query.groupBy}`);
  }
  const requestedPage = request.page;
  const page: PageRequest = {
    limit: requestedPage?.limit ?? DEFAULT_ROWS_PER_GROUP,
    group: requestedPage?.group,
    subGroup: requestedPage?.subGroup,
    cursor: requestedPage?.cursor,
  };

  return boundedTaskRead(async (tx) => {
    const context = await buildQueryContext(tx, {
      workspaceId: caller.workspaceId,
      userId: caller.userId,
      projectIds: query.projectIds ?? undefined,
      timeZone: query.timeZone,
      weekStartsOn: query.weekStartsOn,
      customFieldIds: filterConditions(query.filters)
        .filter((condition) => condition.key === "customField")
        .map((condition) => condition.fieldId ?? ""),
      displayFieldIds: [query.groupBy, query.subGroupBy, query.order.field]
        .filter(isCustomFieldDisplayKey)
        .map(customFieldIdOfKey),
      publicContext,
    });
    const groupsByStatus = [query.groupBy, query.subGroupBy].includes("status");
    if (groupsByStatus && context.projectIds.length !== 1) {
      badRequest(GROUP_BY_STATUS_NEEDS_ONE_PROJECT);
    }

    const plan: Plan = {
      query,
      context,
      condition: compileTaskScope({
        context,
        filters: query.filters,
        archived: query.archived,
        showSubTasks: query.showSubTasks,
        search: query.search ?? undefined,
        registry,
      }),
      store: new MetaStore(tx, context),
      page,
      hash: (group, subGroup) => queryHash(query, group, subGroup),
    };

    if (query.mode === "ids") return runIds(tx, plan);
    if (!query.groupBy) return runUngrouped(tx, plan);
    return runGrouped(tx, plan, query.groupBy);
  }, TASK_QUERY_TIMEOUT);
}
