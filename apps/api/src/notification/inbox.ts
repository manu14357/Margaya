import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import {
  notificationTable,
  taskSubscriberTable,
  taskTable,
} from "../database/schema";
import { hasAnyAssignee } from "../task/assignees";
import { notificationResourceAccess } from "./resource-access";

// Inbox query building (B10 §3.8): the view, tab and type predicates, the
// order of each view and its keyset cursor. The type predicates read the
// resource task through a LEFT JOIN of the unaliased `task` table on
// `taskJoinCondition`.

export const INBOX_VIEWS = ["inbox", "snoozed", "archived"] as const;
export const INBOX_TABS = ["all", "mentions"] as const;
export const INBOX_TYPES = ["assigned", "created", "subscribed"] as const;

export type InboxView = (typeof INBOX_VIEWS)[number];
export type InboxTab = (typeof INBOX_TABS)[number];
export type InboxType = (typeof INBOX_TYPES)[number];

export const INVALID_CURSOR = "Invalid cursor";

/** The comma list of type filters, deduplicated; null when invalid. */
export function parseInboxTypes(
  raw: string | null | undefined,
): InboxType[] | null {
  if (!raw) return [];
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const types: InboxType[] = [];
  for (const part of parts) {
    if (!(INBOX_TYPES as readonly string[]).includes(part)) return null;
    if (!types.includes(part as InboxType)) types.push(part as InboxType);
  }
  return types;
}

export type InboxCursor = { view: InboxView; value: string; id: string };

export function encodeInboxCursor(cursor: InboxCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.view, cursor.value, cursor.id]),
    "utf8",
  ).toString("base64url");
}

/** Throws 400 "Invalid cursor" when malformed or made for another view. */
export function decodeInboxCursor(raw: string, view: InboxView): InboxCursor {
  const invalid = () => new HTTPException(400, { message: INVALID_CURSOR });
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    parsed[0] !== view ||
    typeof parsed[1] !== "string" ||
    typeof parsed[2] !== "string" ||
    parsed[2].length === 0 ||
    Number.isNaN(Date.parse(parsed[1]))
  ) {
    throw invalid();
  }
  return { view, value: parsed[1], id: parsed[2] };
}

/** The instant a view orders by. */
export function inboxSortExpression(view: InboxView): SQL {
  switch (view) {
    case "snoozed":
      return sql`${notificationTable.snoozedUntil}`;
    case "archived":
      return sql`${notificationTable.archivedAt}`;
    default:
      return sql`coalesce(${notificationTable.resurfacedAt}, ${notificationTable.createdAt})`;
  }
}

/** The sort instant as text with microseconds, for exact keyset cursors. */
export function inboxSortKey(view: InboxView): SQL<string> {
  return sql<string>`to_char(${inboxSortExpression(view)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function inboxOrderBy(view: InboxView): SQL[] {
  const sort = inboxSortExpression(view);
  if (view === "snoozed") return [asc(sort), asc(notificationTable.id)];
  // "id desc nulls last" matches notification_inbox_idx exactly.
  return [desc(sort), sql`${notificationTable.id} desc nulls last`];
}

function cursorCondition(view: InboxView, cursor: InboxCursor): SQL {
  const sort = inboxSortExpression(view);
  const value = sql`${cursor.value}::timestamptz`;
  return view === "snoozed"
    ? sql`(${sort}, ${notificationTable.id}) > (${value}, ${cursor.id})`
    : sql`(${sort}, ${notificationTable.id}) < (${value}, ${cursor.id})`;
}

export function inboxViewCondition(view: InboxView, now: Date): SQL {
  switch (view) {
    case "snoozed":
      return and(
        isNull(notificationTable.archivedAt),
        sql`${notificationTable.snoozedUntil} > ${now}`,
      ) as SQL;
    case "archived":
      return isNotNull(notificationTable.archivedAt);
    default:
      return and(
        isNull(notificationTable.archivedAt),
        or(
          isNull(notificationTable.snoozedUntil),
          sql`${notificationTable.snoozedUntil} <= ${now}`,
        ),
      ) as SQL;
  }
}

/** The LEFT JOIN of a notification's resource task. */
export const taskJoinCondition = and(
  eq(notificationTable.resourceType, "task"),
  eq(taskTable.id, notificationTable.resourceId),
) as SQL;

const SUBSCRIBED_ALIAS = "inbox_subscription";
const subscription = alias(taskSubscriberTable, SUBSCRIBED_ALIAS);

/**
 * Any-of type filters, computed from the current relationship. Non-task
 * rows never match. "Subscribed" leaves out tasks the caller created or is
 * assigned to.
 */
export function inboxTypesCondition(
  types: readonly InboxType[],
  userId: string,
): SQL | undefined {
  if (types.length === 0) return undefined;
  const assigned = and(isNotNull(taskTable.id), hasAnyAssignee([userId]));
  const created = eq(taskTable.createdBy, userId);
  const parts = types.map((type) => {
    if (type === "assigned") return assigned;
    if (type === "created") return created;
    return and(
      sql`exists (
        select 1 from ${taskSubscriberTable} as ${sql.identifier(SUBSCRIBED_ALIAS)}
        where ${subscription.taskId} = ${taskTable.id}
          and ${subscription.userId} = ${userId}
          and ${subscription.subscribed} = true
      )`,
      sql`not ${assigned}`,
      sql`${taskTable.createdBy} is distinct from ${userId}`,
    );
  });
  return or(...parts);
}

export type InboxFilter = {
  userId: string;
  workspaceId: string;
  view: InboxView;
  tab: InboxTab;
  unread: boolean;
  types: readonly InboxType[];
  now: Date;
  cursor?: InboxCursor | null;
};

/**
 * The caller's rows of the workspace (and resource-less rows, which show
 * in every workspace) that the access predicate still allows.
 */
export function inboxScopeCondition(userId: string, workspaceId: string): SQL {
  return and(
    eq(notificationTable.userId, userId),
    or(
      eq(notificationTable.workspaceId, workspaceId),
      isNull(notificationTable.workspaceId),
    ),
    notificationResourceAccess(
      userId,
      notificationTable.resourceId,
      notificationTable.resourceType,
    ),
  ) as SQL;
}

/** Every predicate of one inbox request (needs the task LEFT JOIN). */
export function inboxCondition(filter: InboxFilter): SQL {
  return and(
    inboxScopeCondition(filter.userId, filter.workspaceId),
    inboxViewCondition(filter.view, filter.now),
    filter.tab === "mentions"
      ? inArray(notificationTable.type, ["task_mention", "page_mention"])
      : undefined,
    filter.unread ? sql`${notificationTable.isRead} is not true` : undefined,
    inboxTypesCondition(filter.types, filter.userId),
    filter.cursor ? cursorCondition(filter.view, filter.cursor) : undefined,
  ) as SQL;
}
