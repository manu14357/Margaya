import { describe, expect, it } from "vitest";
import {
  buildCandidates,
  isDirectKind,
  preferenceKeyForType,
  TASK_EVENT_POLICY,
} from "../../../apps/api/src/notification/recipient-policy";

const rows = (
  entries: [string, boolean][],
): { userId: string; subscribed: boolean }[] =>
  entries.map(([userId, subscribed]) => ({ userId, subscribed }));

describe("recipient policy", () => {
  it("merges assignees and subscribers for watcher kinds, minus the actor", () => {
    expect(
      buildCandidates({
        kind: "statusChanged",
        assigneeIds: ["a", "b"],
        subscriberRows: rows([["c", true]]),
        actorId: "a",
      }),
    ).toEqual([
      { userId: "b", reason: "assignee" },
      { userId: "c", reason: "subscriber" },
    ]);
  });

  it("gives each user its strongest reason (assignee over subscriber)", () => {
    expect(
      buildCandidates({
        kind: "comment",
        assigneeIds: ["b"],
        subscriberRows: rows([
          ["b", true],
          ["a", true],
        ]),
      }),
    ).toEqual([
      { userId: "b", reason: "assignee" },
      { userId: "a", reason: "subscriber" },
    ]);
  });

  it("removes muted users from non-direct kinds, assignees included", () => {
    for (const kind of [
      "statusChanged",
      "comment",
      "updated",
      "timeEntry",
      "created",
    ] as const) {
      expect(
        buildCandidates({
          kind,
          assigneeIds: ["d", "e"],
          subscriberRows: rows([["d", false]]),
        }).map((c) => c.userId),
      ).toEqual(["e"]);
    }
  });

  it("keeps muted users for direct kinds", () => {
    expect(
      buildCandidates({
        kind: "mention",
        assigneeIds: ["x"],
        subscriberRows: rows([["d", false]]),
        mentionedIds: ["d"],
      }),
    ).toEqual([{ userId: "d", reason: "mention" }]);
    expect(
      buildCandidates({
        kind: "assigned",
        assigneeIds: ["x"],
        subscriberRows: rows([["d", false]]),
        directIds: ["d"],
      }),
    ).toEqual([{ userId: "d", reason: "direct" }]);
  });

  it("uses only assignees for created and timeEntry", () => {
    for (const kind of ["created", "timeEntry"] as const) {
      expect(
        buildCandidates({
          kind,
          assigneeIds: ["a"],
          subscriberRows: rows([["s", true]]),
        }).map((c) => c.userId),
      ).toEqual(["a"]);
    }
  });

  it("uses only the targets for direct kinds", () => {
    expect(
      buildCandidates({
        kind: "assigned",
        assigneeIds: ["a", "b"],
        subscriberRows: rows([["s", true]]),
        directIds: ["b"],
        actorId: "a",
      }),
    ).toEqual([{ userId: "b", reason: "direct" }]);
  });

  it("never notifies the actor, even when directly targeted", () => {
    expect(
      buildCandidates({
        kind: "assigned",
        assigneeIds: [],
        subscriberRows: [],
        directIds: ["a"],
        actorId: "a",
      }),
    ).toEqual([]);
  });

  it("drops exclude ids and orders by reason then id", () => {
    expect(
      buildCandidates({
        kind: "comment",
        assigneeIds: ["z", "m"],
        subscriberRows: rows([
          ["b", true],
          ["c", true],
        ]),
        excludeIds: ["c"],
      }),
    ).toEqual([
      { userId: "m", reason: "assignee" },
      { userId: "z", reason: "assignee" },
      { userId: "b", reason: "subscriber" },
    ]);
  });

  it("maps every type to its preference switch", () => {
    expect(preferenceKeyForType("task_created")).toBe("taskAssignmentEnabled");
    expect(preferenceKeyForType("task_assignee_changed")).toBe(
      "taskAssignmentEnabled",
    );
    expect(preferenceKeyForType("task_comment")).toBe("taskCommentEnabled");
    expect(preferenceKeyForType("task_mention")).toBe("taskCommentEnabled");
    expect(preferenceKeyForType("task_status_changed")).toBe(
      "taskStatusChangeEnabled",
    );
    expect(preferenceKeyForType("task_updated")).toBe("taskUpdateEnabled");
    expect(preferenceKeyForType("due_date_reminder")).toBe(
      "dueDateReminderEnabled",
    );
    expect(preferenceKeyForType("time_entry_created")).toBeNull();
    expect(preferenceKeyForType("info")).toBeNull();
  });

  it("marks only assignment, mention and intake outcome kinds as direct", () => {
    expect(
      Object.keys(TASK_EVENT_POLICY).filter((kind) =>
        isDirectKind(kind as keyof typeof TASK_EVENT_POLICY),
      ),
    ).toEqual([
      "assigned",
      "mention",
      "intakeAccepted",
      "intakeDeclined",
      "intakeDuplicate",
    ]);
  });

  it("maps intake outcomes to the status-change switch", () => {
    for (const type of [
      "intake_accepted",
      "intake_declined",
      "intake_duplicate",
    ]) {
      expect(preferenceKeyForType(type)).toBe("taskStatusChangeEnabled");
    }
  });
});
