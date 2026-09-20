import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  applyActionToPages,
  applyCountDelta,
  countDelta,
  flattenInboxPages,
  type InboxPageLike,
  type InboxRowState,
} from "./inbox-cache";

const now = new Date("2026-09-26T12:00:00.000Z");

function row(overrides: Partial<InboxRowState> = {}): InboxRowState {
  return {
    id: "n1",
    type: "task_comment",
    workspaceId: "ws",
    isRead: false,
    archivedAt: null,
    snoozedUntil: null,
    resurfacedAt: null,
    isSnoozed: false,
    ...overrides,
  };
}

function pages(
  ...items: InboxRowState[][]
): InfiniteData<InboxPageLike<InboxRowState>> {
  return {
    pages: items.map((list) => ({ items: list, nextCursor: null })),
    pageParams: items.map((_, index) =>
      index === 0 ? undefined : `c${index}`,
    ),
  };
}

describe("applyActionToPages", () => {
  it("archive removes the row from Inbox pages", () => {
    const data = pages([row(), row({ id: "n2" })]);
    const next = applyActionToPages(
      data,
      "n1",
      { action: "archive" },
      "inbox",
      now,
    );
    expect(next?.pages[0]?.items.map((item) => item.id)).toEqual(["n2"]);
  });

  it("unarchive keeps nothing in Archived pages, archive keeps it there", () => {
    const archived = row({ archivedAt: "2026-09-25T00:00:00.000Z" });
    const data = pages([archived]);
    expect(
      applyActionToPages(data, "n1", { action: "unarchive" }, "archived", now)
        ?.pages[0]?.items,
    ).toEqual([]);
    expect(
      applyActionToPages(data, "n1", { action: "read" }, "archived", now)
        ?.pages[0]?.items[0],
    ).toMatchObject({ id: "n1", isRead: true });
  });

  it("snooze removes the row from Inbox and adds nothing elsewhere", () => {
    const until = "2026-09-27T12:00:00.000Z";
    const inbox = pages([row()]);
    const snoozed = pages([row({ id: "other", isSnoozed: true })]);
    expect(
      applyActionToPages(inbox, "n1", { action: "snooze", until }, "inbox", now)
        ?.pages[0]?.items,
    ).toEqual([]);
    const untouched = applyActionToPages(
      snoozed,
      "n1",
      { action: "snooze", until },
      "snoozed",
      now,
    );
    expect(untouched).toBe(snoozed);
  });

  it("updates read state in place", () => {
    const data = pages([row({ isRead: true })]);
    const next = applyActionToPages(
      data,
      "n1",
      { action: "unread" },
      "inbox",
      now,
    );
    expect(next?.pages[0]?.items[0]?.isRead).toBe(false);
  });
});

describe("countDelta", () => {
  it("marking an unread inbox row read gives -1 unread", () => {
    expect(countDelta(row(), { action: "read" }, now)).toEqual({
      unread: -1,
      unreadMentions: 0,
    });
  });

  it("counts mentions too", () => {
    expect(
      countDelta(row({ type: "task_mention" }), { action: "archive" }, now),
    ).toEqual({ unread: -1, unreadMentions: -1 });
    expect(
      countDelta(
        row({ type: "task_mention", isRead: true }),
        { action: "unread" },
        now,
      ),
    ).toEqual({ unread: 1, unreadMentions: 1 });
  });

  it("ignores rows outside the Inbox view", () => {
    expect(
      countDelta(
        row({ archivedAt: "2026-09-25T00:00:00.000Z" }),
        { action: "unread" },
        now,
      ),
    ).toEqual({ unread: 0, unreadMentions: 0 });
    expect(
      countDelta(
        row({ isSnoozed: true, snoozedUntil: "2026-09-27T00:00:00.000Z" }),
        { action: "unsnooze" },
        now,
      ),
    ).toEqual({ unread: 1, unreadMentions: 0 });
  });

  it("never lets counts go below zero", () => {
    expect(
      applyCountDelta(
        { unread: 0, unreadMentions: 0 },
        {
          unread: -1,
          unreadMentions: -1,
        },
      ),
    ).toEqual({ unread: 0, unreadMentions: 0 });
  });
});

describe("flattenInboxPages", () => {
  it("merges pages by id", () => {
    const data = pages(
      [row(), row({ id: "n2" })],
      [row({ id: "n2" }), row({ id: "n3" })],
    );
    expect(flattenInboxPages(data).map((item) => item.id)).toEqual([
      "n1",
      "n2",
      "n3",
    ]);
  });
});
