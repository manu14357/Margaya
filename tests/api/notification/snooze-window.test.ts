import { describe, expect, it } from "vitest";
import {
  assertSnoozeWindow,
  notificationStatePatch,
  SNOOZE_TOO_LATE,
  SNOOZE_TOO_SOON,
} from "../../../apps/api/src/notification/state";

const now = new Date("2026-09-26T10:00:00.000Z");
const at = (ms: number) => new Date(now.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

function messageOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe("snooze window", () => {
  it("accepts exactly one minute ahead and rejects less", () => {
    expect(messageOf(() => assertSnoozeWindow(at(60_000), now))).toBeNull();
    expect(messageOf(() => assertSnoozeWindow(at(59_000), now))).toBe(
      SNOOZE_TOO_SOON,
    );
    expect(messageOf(() => assertSnoozeWindow(at(-DAY), now))).toBe(
      SNOOZE_TOO_SOON,
    );
  });

  it("accepts 366 days and rejects one second more", () => {
    expect(messageOf(() => assertSnoozeWindow(at(366 * DAY), now))).toBeNull();
    expect(messageOf(() => assertSnoozeWindow(at(366 * DAY + 1000), now))).toBe(
      SNOOZE_TOO_LATE,
    );
  });
});

describe("notification state transitions", () => {
  const fresh = { isRead: false, archivedAt: null, snoozedUntil: null };

  it("read and unread are no-ops when already in that state", () => {
    expect(notificationStatePatch(fresh, { action: "read" }, now)).toEqual({
      isRead: true,
    });
    expect(
      notificationStatePatch(
        { ...fresh, isRead: true },
        { action: "read" },
        now,
      ),
    ).toBeNull();
    expect(notificationStatePatch(fresh, { action: "unread" }, now)).toBeNull();
    expect(
      notificationStatePatch(
        { ...fresh, isRead: null },
        { action: "unread" },
        now,
      ),
    ).toBeNull();
  });

  it("archive clears a snooze, snooze clears an archive", () => {
    const snoozed = { ...fresh, snoozedUntil: at(DAY) };
    expect(notificationStatePatch(snoozed, { action: "archive" }, now)).toEqual(
      {
        archivedAt: now,
        snoozedUntil: null,
      },
    );
    const archived = { ...fresh, archivedAt: now };
    expect(
      notificationStatePatch(
        archived,
        { action: "snooze", until: at(DAY) },
        now,
      ),
    ).toEqual({ snoozedUntil: at(DAY), archivedAt: null });
    expect(
      notificationStatePatch(archived, { action: "archive" }, now),
    ).toBeNull();
    expect(
      notificationStatePatch(fresh, { action: "unarchive" }, now),
    ).toBeNull();
  });

  it("unsnooze resurfaces now and keeps the read state", () => {
    expect(
      notificationStatePatch(
        { ...fresh, isRead: true, snoozedUntil: at(DAY) },
        { action: "unsnooze" },
        now,
      ),
    ).toEqual({ snoozedUntil: null, resurfacedAt: now });
    expect(
      notificationStatePatch(fresh, { action: "unsnooze" }, now),
    ).toBeNull();
  });
});
