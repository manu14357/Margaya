import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const { isTaskActionKind, pickDesktopActions } = await import(
  "../../../apps/api/src/notification/desktop-actions"
);

const open = {
  canWrite: true,
  canUpdate: true,
  entitled: true,
  archived: false,
  group: "started",
  hasDoneColumn: true,
};

describe("desktop alert actions", () => {
  it("offers done, snooze and reply on an open task the caller may update", () => {
    expect(pickDesktopActions(open)).toEqual(["done", "snooze", "reply"]);
    expect(pickDesktopActions({ ...open, group: "backlog" })).toEqual([
      "done",
      "snooze",
      "reply",
    ]);
  });

  it("offers only snooze without task:update, which done and comments take", () => {
    expect(pickDesktopActions({ ...open, canUpdate: false })).toEqual([
      "snooze",
    ]);
  });

  it("offers nothing to credentials that can't write, such as a read-only API key", () => {
    expect(pickDesktopActions({ ...open, canWrite: false })).toEqual([]);
    expect(
      pickDesktopActions({ ...open, canWrite: false, canUpdate: false }),
    ).toEqual([]);
  });

  it("leaves done out for closed, archived and intake tasks, and projects without a completed column", () => {
    for (const group of ["completed", "cancelled", "triage"]) {
      expect(pickDesktopActions({ ...open, group })).toEqual([
        "snooze",
        "reply",
      ]);
    }
    expect(pickDesktopActions({ ...open, archived: true })).toEqual([
      "snooze",
      "reply",
    ]);
    expect(pickDesktopActions({ ...open, hasDoneColumn: false })).toEqual([
      "snooze",
      "reply",
    ]);
    // A workspace whose plan ran out can't move tasks; commenting has no
    // such check.
    expect(pickDesktopActions({ ...open, entitled: false })).toEqual([
      "snooze",
      "reply",
    ]);
  });

  it("acts on task kinds only, due-date reminders included", () => {
    for (const type of [
      "due_date_reminder",
      "task_overdue",
      "task_comment",
      "task_mention",
      "task_assignee_changed",
      "task_created",
      "task_status_changed",
      "task_updated",
    ]) {
      expect(isTaskActionKind(type, "task")).toBe(true);
    }
    expect(isTaskActionKind("due_date_reminder", "workspace")).toBe(false);
    expect(isTaskActionKind("info", "task")).toBe(false);
    expect(isTaskActionKind("page_comment", "page")).toBe(false);
    expect(isTaskActionKind("intake_accepted", "task")).toBe(false);
    expect(isTaskActionKind(null, null)).toBe(false);
  });
});
