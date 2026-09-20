import { describe, expect, it } from "vitest";
import {
  defaultTabStatuses,
  effectiveIntakeStatus,
  formatIntakeKey,
  intakeItemPath,
  isOpenIntakeStatus,
  nextSelectionAfterRemoval,
  snoozeDaysLeft,
  tabOfStatus,
  tabStatuses,
} from "./intake";

describe("intake status model", () => {
  it("splits statuses into the open and closed tabs", () => {
    expect(tabStatuses("open")).toEqual(["pending", "snoozed"]);
    expect(tabStatuses("closed")).toEqual([
      "accepted",
      "declined",
      "duplicate",
    ]);
    expect(defaultTabStatuses("open")).toEqual(["pending"]);
    expect(defaultTabStatuses("closed")).toEqual([
      "accepted",
      "declined",
      "duplicate",
    ]);
    expect(isOpenIntakeStatus("snoozed")).toBe(true);
    expect(isOpenIntakeStatus("declined")).toBe(false);
    expect(tabOfStatus("duplicate")).toBe("closed");
  });

  it("reads a snooze that has passed as pending", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const snoozed = { status: "snoozed" as const };
    expect(
      effectiveIntakeStatus(
        { ...snoozed, snoozedUntil: "2026-10-01T11:59:59Z" },
        now,
      ),
    ).toBe("pending");
    expect(
      effectiveIntakeStatus(
        { ...snoozed, snoozedUntil: "2026-10-01T12:00:00Z" },
        now,
      ),
    ).toBe("pending");
    expect(
      effectiveIntakeStatus(
        { ...snoozed, snoozedUntil: "2026-10-01T12:00:01Z" },
        now,
      ),
    ).toBe("snoozed");
    expect(
      effectiveIntakeStatus({ status: "declined", snoozedUntil: null }, now),
    ).toBe("declined");
  });
});

describe("nextSelectionAfterRemoval", () => {
  it("selects the next row, else the previous one, else none", () => {
    expect(nextSelectionAfterRemoval(["a", "b", "c"], "b")).toBe("c");
    expect(nextSelectionAfterRemoval(["a", "b", "c"], "c")).toBe("b");
    expect(nextSelectionAfterRemoval(["a"], "a")).toBeNull();
    expect(nextSelectionAfterRemoval(["a", "b"], "x")).toBeNull();
  });
});

describe("display helpers", () => {
  it("uppercases keys", () => {
    expect(formatIntakeKey("web-12")).toBe("WEB-12");
  });

  it("counts whole days left, at least one", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(snoozeDaysLeft("2026-10-01T13:00:00Z", now)).toBe(1);
    expect(snoozeDaysLeft("2026-10-03T12:00:00Z", now)).toBe(2);
    expect(snoozeDaysLeft("2026-10-03T12:00:01Z", now)).toBe(3);
    expect(snoozeDaysLeft("2026-09-30T12:00:00Z", now)).toBe(1);
  });

  it("links a request under the tab that lists it", () => {
    const base = { workspaceId: "ws", projectId: "p1", itemId: "i1" };
    expect(intakeItemPath({ ...base, status: "pending" })).toBe(
      "/dashboard/workspace/ws/project/p1/intake?item=i1",
    );
    expect(intakeItemPath({ ...base, status: "declined" })).toBe(
      "/dashboard/workspace/ws/project/p1/intake?item=i1&tab=closed",
    );
  });
});
