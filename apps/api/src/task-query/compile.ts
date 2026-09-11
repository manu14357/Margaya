import {
  and,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { taskTable } from "../database/schema";
import { escapeLikePattern } from "../search/like-pattern";
import { TASK_SHORT_ID_PATTERN } from "../search/task-short-id";
import { archivedCondition, inTriageColumnSql } from "../task/scope";
import { type QueryContext, textArray } from "./context";
import {
  addDays,
  type DatePreset,
  type DayRange,
  presetRange,
  type RollingOperator,
  rollingRange,
  toInstantRange,
} from "./dates";
import {
  type DateFilterKey,
  type FilterKeyRegistry,
  filterKeyRegistry,
  type SetFilterKey,
} from "./keys";
import { hasNoParentSql } from "./keys/parent";
import {
  type ArchivedFilter,
  type FilterCondition,
  type FilterNode,
  isFilterGroup,
} from "./schema";
import { unsupportedFilter } from "./validate";

// Filter tree to one SQL condition (B4 §2.4, §3.3). Every condition is a
// predicate on the outer `task` row: many-valued keys are EXISTS subqueries,
// never joins, so a task stays one row and indexes drive the lookups. The
// result needs `column` LEFT JOINed through taskColumnJoin.

export const NONE_TOKEN = "none";
export const ME_TOKEN = "me";

const MAX_TASK_NUMBER = 2_147_483_647;

function compileSetCondition(
  descriptor: SetFilterKey,
  condition: FilterCondition,
  context: QueryContext,
): SQL {
  const unique = [...new Set(condition.values ?? [])];
  const withNone = unique.includes(NONE_TOKEN);
  let values = unique.filter((value) => value !== NONE_TOKEN);
  if (descriptor.tokens?.includes(ME_TOKEN) && values.includes(ME_TOKEN)) {
    if (context.publicContext) {
      throw new HTTPException(400, {
        message: `Unsupported value for ${condition.key}: me`,
      });
    }
    values = [
      ...new Set(
        values.map((value) => (value === ME_TOKEN ? context.userId : value)),
      ),
    ];
  }

  // V ∩ X ≠ ∅ and V = ∅, both two-valued, combined per the §2.4 table.
  const matchesAny =
    values.length > 0
      ? descriptor.matchAny(values, context, condition)
      : sql`false`;
  const isEmpty = descriptor.isEmpty(context, condition);
  if (condition.operator === "in") {
    return withNone ? (or(matchesAny, isEmpty) as SQL) : matchesAny;
  }
  return withNone
    ? (and(not(matchesAny), not(isEmpty)) as SQL)
    : not(matchesAny);
}

function compileDateCondition(
  descriptor: DateFilterKey,
  condition: FilterCondition,
  context: QueryContext,
): SQL {
  const column = descriptor.column;
  const unset = descriptor.nullable ? isNull(column) : sql`false`;
  const within = (range: DayRange): SQL => {
    const { gte: start, lt: end } = toInstantRange(range, context.timeZone);
    return (
      and(
        descriptor.nullable ? isNotNull(column) : undefined,
        start ? gte(column, start) : undefined,
        end ? lt(column, end) : undefined,
      ) ?? sql`true`
    );
  };

  const day = condition.date ?? "";
  switch (condition.operator) {
    case "on":
      return within({ from: day, until: addDays(day, 1) });
    case "onOrBefore":
      return within({ from: null, until: addDays(day, 1) });
    case "onOrAfter":
      return within({ from: day, until: null });
    case "between":
      return within({
        from: condition.from ?? "",
        until: addDays(condition.to ?? "", 1),
      });
    case "withinLast":
    case "withinNext":
    case "moreThanAgo":
    case "moreThanAhead":
      return within(
        rollingRange(
          condition.operator as RollingOperator,
          condition.amount ?? 1,
          condition.unit ?? "days",
          context.today,
        ),
      );
    case "in":
      return or(
        ...[...new Set(condition.values ?? [])].map((preset) => {
          const range = presetRange(
            preset as DatePreset,
            context.today,
            context.weekStartsOn,
          );
          return range ? within(range) : unset;
        }),
      ) as SQL;
    case "empty":
      return unset;
    default:
      return descriptor.nullable ? isNotNull(column) : sql`true`;
  }
}

function compileCondition(
  condition: FilterCondition,
  context: QueryContext,
  registry: FilterKeyRegistry,
): SQL {
  const descriptor = registry.get(condition.key);
  if (!descriptor || (context.publicContext && descriptor.personal)) {
    unsupportedFilter(condition.key);
  }
  return descriptor.kind === "set"
    ? compileSetCondition(descriptor, condition, context)
    : compileDateCondition(descriptor, condition, context);
}

/** A validated filter tree as one condition; undefined for no filters. */
export function compileFilterTree(
  node: FilterNode | null | undefined,
  context: QueryContext,
  registry: FilterKeyRegistry = filterKeyRegistry,
): SQL | undefined {
  if (!node) return undefined;
  if (!isFilterGroup(node)) return compileCondition(node, context, registry);
  const children = node.children.map(
    (child) => compileFilterTree(child, context, registry) as SQL,
  );
  return node.op === "and" ? and(...children) : or(...children);
}

/**
 * Title contains the text (case-insensitive, wildcards literal), or a task
 * key: "WEB-12" is that project's task 12, "#12" and "12" are number 12.
 */
export function searchCondition(
  search: string | undefined,
  context: QueryContext,
): SQL | undefined {
  const text = search?.trim();
  if (!text) return undefined;
  const titleMatch = ilike(taskTable.title, `%${escapeLikePattern(text)}%`);

  const key = text.normalize("NFKC").match(TASK_SHORT_ID_PATTERN);
  if (key?.[1] && key[2]) {
    const slug = key[1].toLowerCase();
    const number = Number(key[2]);
    const projectIds = context.projects
      .filter((project) => project.slug.toLowerCase() === slug)
      .map((project) => project.id);
    if (projectIds.length === 0 || number > MAX_TASK_NUMBER) return titleMatch;
    return or(
      and(
        sql`${taskTable.projectId} = any(${textArray(projectIds)})`,
        eq(taskTable.number, number),
      ),
      titleMatch,
    );
  }

  const number = /^#?(\d{1,10})$/.exec(text)?.[1];
  if (number !== undefined && Number(number) <= MAX_TASK_NUMBER) {
    return or(eq(taskTable.number, Number(number)), titleMatch);
  }
  return titleMatch;
}

/** The scope projects, as an explicit list (the scope is the whole point). */
function inScope(context: QueryContext): SQL {
  if (context.projectIds.length === 0) return sql`false`;
  return sql`${taskTable.projectId} = any(${textArray(context.projectIds)})`;
}

export type TaskScopeInput = {
  context: QueryContext;
  filters?: FilterNode | null;
  archived?: ArchivedFilter;
  showSubTasks?: boolean;
  search?: string;
  registry?: FilterKeyRegistry;
};

/**
 * The engine's task set as one condition: scope projects, never triage (B1
 * D5), the archived rule, the sub-task rule, the search and the filters.
 * Needs `column` LEFT JOINed through taskColumnJoin. B8 counts with exactly
 * these semantics.
 */
export function compileTaskScope({
  context,
  filters,
  archived = "exclude",
  showSubTasks = true,
  search,
  registry = filterKeyRegistry,
}: TaskScopeInput): SQL {
  return and(
    inScope(context),
    sql`not ${inTriageColumnSql}`,
    archivedCondition(archived),
    showSubTasks ? undefined : hasNoParentSql,
    searchCondition(search, context),
    compileFilterTree(filters, context, registry),
  ) as SQL;
}
