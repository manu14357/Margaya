import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

export type Notification = Extract<
  InferResponseType<(typeof client)["notification"]["$get"], 200>[number],
  { id: string }
>;

export type NotificationEventData = Record<string, unknown> | null | undefined;

export type InboxPage = InferResponseType<
  (typeof client)["notification"]["inbox"]["$get"],
  200
>;

export type InboxNotification = InboxPage["items"][number];

export type InboxCounts = InferResponseType<
  (typeof client)["notification"]["counts"]["$get"],
  200
>;

export const INBOX_TABS = ["all", "mentions"] as const;
export const INBOX_VIEWS = ["inbox", "snoozed", "archived"] as const;
export const INBOX_TYPES = ["assigned", "created", "subscribed"] as const;

export type InboxTab = (typeof INBOX_TABS)[number];
export type InboxView = (typeof INBOX_VIEWS)[number];
export type InboxType = (typeof INBOX_TYPES)[number];

export type InboxFilters = {
  tab: InboxTab;
  view: InboxView;
  unread: boolean;
  types: InboxType[];
};

/** A per-notification state change, as the API's PATCH routes name it. */
export type NotificationStateAction =
  | { action: "read" }
  | { action: "unread" }
  | { action: "archive" }
  | { action: "unarchive" }
  | { action: "snooze"; until: string }
  | { action: "unsnooze" };
