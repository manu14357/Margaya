import { HTTPException } from "hono/http-exception";
import { PLANNED_STATUS } from "../task/scope";
import { LABEL_NAME_PREFIX } from "../task-query/keys/label";
import type { FilterCondition, TaskQueryRequest } from "../task-query/schema";

// The public task list (B12 §3.7): query string to engine request, and
// engine rows to the public row shape. Pure.

export const PUBLIC_SORTS = [
  "manual",
  "newest",
  "updated",
  "dueDate",
  "priority",
  "votes",
] as const;
export type PublicSort = (typeof PUBLIC_SORTS)[number];

const PRIORITIES = ["urgent", "high", "medium", "low", "no-priority"];
export const VOTES_SORT_OFF = "Sorting by votes needs votes turned on";

const ORDER: Record<
  PublicSort,
  {
    field:
      | "manual"
      | "createdAt"
      | "updatedAt"
      | "dueDate"
      | "priority"
      | "voteScore";
    direction: "asc" | "desc";
  }
> = {
  manual: { field: "manual", direction: "asc" },
  newest: { field: "createdAt", direction: "desc" },
  updated: { field: "updatedAt", direction: "desc" },
  dueDate: { field: "dueDate", direction: "asc" },
  priority: { field: "priority", direction: "desc" },
  votes: { field: "voteScore", direction: "desc" },
};

export type BoardListQuery = {
  status?: string;
  priority?: string;
  label?: string;
  q?: string;
  sort?: string;
  group?: string;
  cursor?: string;
  limit?: number;
};

type BoardFacts = {
  workspaceId: string;
  projectId: string;
  showBacklog: boolean;
  votesEnabled: boolean;
  /** Board column slugs, triage excluded. */
  columnSlugs: readonly string[];
};

function commaList(raw: string | undefined, max: number): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ].slice(0, max);
}

/** The sorts this board offers. */
export function boardSorts(votesEnabled: boolean): PublicSort[] {
  return PUBLIC_SORTS.filter((sort) => sort !== "votes" || votesEnabled);
}

/** The engine request for a board's task list. Unknown values are dropped. */
export function boardTaskQuery(
  board: BoardFacts,
  query: BoardListQuery,
): TaskQueryRequest {
  const allowedStatuses = new Set([
    ...board.columnSlugs,
    ...(board.showBacklog ? [PLANNED_STATUS] : []),
  ]);
  const statuses = commaList(query.status, 50).filter((status) =>
    allowedStatuses.has(status),
  );
  const priorities = commaList(query.priority, 5).filter((priority) =>
    PRIORITIES.includes(priority),
  );
  const labels = commaList(query.label, 20).filter(
    (label) => label.length <= 64,
  );

  const conditions: FilterCondition[] = [];
  if (!board.showBacklog) {
    conditions.push({
      key: "status",
      operator: "notIn",
      values: [PLANNED_STATUS],
    });
  }
  if (statuses.length > 0) {
    conditions.push({ key: "status", operator: "in", values: statuses });
  }
  if (priorities.length > 0) {
    conditions.push({ key: "priority", operator: "in", values: priorities });
  }
  if (labels.length > 0) {
    conditions.push({
      key: "label",
      operator: "in",
      values: labels.map((name) => `${LABEL_NAME_PREFIX}${name}`),
    });
  }

  const sort = (PUBLIC_SORTS as readonly string[]).includes(query.sort ?? "")
    ? (query.sort as PublicSort)
    : "manual";
  if (sort === "votes" && !board.votesEnabled) {
    throw new HTTPException(400, { message: VOTES_SORT_OFF });
  }

  const search = query.q?.trim().slice(0, 100);
  return {
    workspaceId: board.workspaceId,
    scope: { projectIds: [board.projectId] },
    filters:
      conditions.length === 0
        ? null
        : conditions.length === 1
          ? (conditions[0] as FilterCondition)
          : { op: "and", children: conditions },
    archived: "exclude",
    ...(search ? { search } : {}),
    display: {
      groupBy: "status",
      orderBy: ORDER[sort],
      showSubTasks: true,
      showEmptyGroups: true,
    },
    // Assignee names come from B14a's helper; the engine returns only ids.
    include: ["labels"],
    page: {
      limit: Math.min(Math.max(query.limit ?? 50, 1), 100),
      ...(query.group ? { group: query.group } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    },
    context: { timeZone: "UTC" },
  };
}

export type PublicPerson = { name: string; image: string | null };

type EngineRow = {
  id: string;
  number: number | null;
  key: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  startDate: Date | null;
  labels?: { name: string; color: string }[];
};

export type PublicCounts = {
  votes?: { up: number; down: number };
  reactions?: { emoji: string; count: number }[];
  comments?: number;
};

/**
 * The public row: only the listed fields, never user ids or emails.
 * Counts are present only for the features the board has on.
 */
export function publicTaskRow(
  row: EngineRow,
  { assignees, counts }: { assignees?: PublicPerson[]; counts: PublicCounts },
) {
  return {
    id: row.id,
    number: row.number,
    key: row.key,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    startDate: row.startDate,
    labels: (row.labels ?? []).map((label) => ({
      name: label.name,
      color: label.color,
    })),
    ...(assignees ? { assignees } : {}),
    counts: {
      ...(counts.votes
        ? { votesUp: counts.votes.up, votesDown: counts.votes.down }
        : {}),
      ...(counts.reactions ? { reactions: counts.reactions } : {}),
      ...(counts.comments !== undefined ? { comments: counts.comments } : {}),
    },
  };
}
