import { type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import {
  taskMentionTable,
  taskSubscriberTable,
  taskTable,
} from "../database/schema";
import {
  isFilterKeyRegistered,
  registerFilterKey,
  type SetFilterKey,
} from "../task-query/keys/registry";
import type { FilterCondition } from "../task-query/schema";

// The task-query filter keys B4 reserved for B10 (§3.11). Who watches what
// is personal, so `subscriber` accepts only the caller; mentions are visible
// in task content, so `mention` accepts any member. Neither has a "none".

export const OWN_SUBSCRIPTIONS_ONLY =
  "You can only filter by your own subscriptions";

function refuseNone(condition: FilterCondition): void {
  if (condition.values?.includes("none")) {
    throw new HTTPException(400, {
      message: `Unsupported value for ${condition.key}: none`,
    });
  }
}

/** Throws unless every value is `me` or the caller's own id. */
export function assertOwnSubscriptionValues(
  values: readonly string[],
  userId: string,
): void {
  if (values.some((value) => value !== "me" && value !== userId)) {
    throw new HTTPException(400, { message: OWN_SUBSCRIPTIONS_ONLY });
  }
}

const SUBSCRIBER_ALIAS = "task_subscriber_filter";
const subscriber = alias(taskSubscriberTable, SUBSCRIBER_ALIAS);

export const subscriberKey: SetFilterKey = {
  key: "subscriber",
  kind: "set",
  tokens: ["me"],
  personal: true,
  matchAny(userIds, context, condition) {
    refuseNone(condition);
    assertOwnSubscriptionValues(userIds, context.userId);
    return sql`exists (
      select 1 from ${taskSubscriberTable} as ${sql.identifier(SUBSCRIBER_ALIAS)}
      where ${subscriber.taskId} = ${taskTable.id}
        and ${subscriber.subscribed} = true
        and ${subscriber.userId} = any(${sql.param([...userIds])}::text[])
    )`;
  },
  isEmpty(_context, condition): SQL {
    refuseNone(condition);
    return sql`false`;
  },
};

const MENTION_ALIAS = "task_mention_filter";
const mention = alias(taskMentionTable, MENTION_ALIAS);

export const mentionKey: SetFilterKey = {
  key: "mention",
  kind: "set",
  tokens: ["me"],
  // A public board refuses it too.
  personal: true,
  matchAny(userIds, _context, condition) {
    refuseNone(condition);
    return sql`exists (
      select 1 from ${taskMentionTable} as ${sql.identifier(MENTION_ALIAS)}
      where ${mention.taskId} = ${taskTable.id}
        and ${mention.userId} = any(${sql.param([...userIds])}::text[])
    )`;
  },
  isEmpty(_context, condition): SQL {
    refuseNone(condition);
    return sql`false`;
  },
};

for (const descriptor of [subscriberKey, mentionKey]) {
  if (!isFilterKeyRegistered(descriptor.key)) registerFilterKey(descriptor);
}
