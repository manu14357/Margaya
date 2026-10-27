import { describe, expect, it } from "vitest";
import {
  getFlowAnomalyTarget,
  getNotificationActorName,
  getNotificationContent,
  getNotificationPreview,
  getNotificationTitle,
  getNotificationVerb,
  getPageMentionTitle,
  isSystemNotification,
  type NotificationTextSource,
} from "./notification-text";

const t = (key: string, options?: Record<string, unknown>) => {
  if (key === "notifications:reminderLeadTime.days") {
    return `${options?.count} days`;
  }
  if (key === "notifications:events.due_date_reminder.content") {
    return `${options?.taskTitle} is due in ${options?.leadTime}`;
  }
  if (key === "notifications:events.task_comment.title") {
    return `${options?.commenterName} commented`;
  }
  if (key === "notifications:events.task_comment.content") {
    return `New comment on ${options?.taskTitle}: ${options?.commentPreview}`;
  }
  const values = Object.entries(options ?? {})
    .filter(
      ([name, value]) =>
        ["newValue", "oldValue", "leadTime", "pageTitle"].includes(name) &&
        value !== null,
    )
    .map(([name, value]) => `${name}=${value}`);
  return values.length > 0 ? `${key}(${values.join(",")})` : key;
};

function notification(
  type: string,
  eventData: Record<string, unknown>,
  actor: { name: string } | null = null,
): NotificationTextSource {
  return { type, title: null, content: null, eventData, actor };
}

describe("notification display content", () => {
  it("renders configured due-date lead times", () => {
    const item = notification("due_date_reminder", {
      taskTitle: "Launch website",
      leadTimeMinutes: 2880,
    });

    expect(getNotificationTitle(item, t)).toBe(
      "notifications:events.due_date_reminder.title",
    );
    expect(getNotificationContent(item, t)).toBe(
      "Launch website is due in 2 days",
    );
  });

  it("renders comment notifications with their preview", () => {
    const item = notification("task_comment", {
      taskTitle: "Launch website",
      commenterName: "Mina",
      commentPreview: "Ready for review",
    });

    expect(getNotificationTitle(item, t)).toBe("Mina commented");
    expect(getNotificationContent(item, t)).toBe(
      "New comment on Launch website: Ready for review",
    );
    expect(getNotificationPreview(item)).toBe("Ready for review");
  });

  it("renders task_updated content per field", () => {
    expect(
      getNotificationContent(
        notification("task_updated", {
          field: "priority",
          oldValue: "low",
          newValue: "high",
        }),
        t,
      ),
    ).toBe(
      "notifications:events.task_updated.priority(oldValue=Low,newValue=High)",
    );
    expect(
      getNotificationContent(
        notification("task_updated", { field: "dueDate", newValue: null }),
        t,
      ),
    ).toBe("notifications:events.task_updated.dueDateCleared");
    expect(
      getNotificationContent(
        notification("task_updated", {
          field: "title",
          oldValue: "Old",
          newValue: "New",
        }),
        t,
      ),
    ).toBe(
      "notifications:events.task_updated.title_change(oldValue=Old,newValue=New)",
    );
    expect(
      getNotificationTitle(notification("task_updated", { field: "title" }), t),
    ).toBe("notifications:events.task_updated.title");
  });

  it("uses the comment wording for mentions in comments", () => {
    expect(
      getNotificationContent(
        notification("task_mention", { source: "comment" }),
        t,
      ),
    ).toBe("notifications:events.task_mention.contentComment");
    expect(
      getNotificationContent(
        notification("task_mention", { source: "description" }),
        t,
      ),
    ).toBe("notifications:events.task_mention.content");
  });

  it("renders cycle rollover summaries by outcome", () => {
    const moved = notification("cycle_rollover", {
      cycleName: "Sprint 1",
      targetCycleName: "Sprint 2",
      outcome: "moved",
      count: 3,
    });
    expect(getNotificationTitle(moved, t)).toBe(
      "notifications:events.cycle_rollover.title",
    );
    expect(getNotificationContent(moved, t)).toBe(
      "notifications:events.cycle_rollover.content",
    );
    expect(isSystemNotification(moved)).toBe(true);
    expect(
      getNotificationContent(
        notification("cycle_rollover", { outcome: "no_next_cycle", count: 2 }),
        t,
      ),
    ).toBe("notifications:events.cycle_rollover.contentNoNext");
  });

  it("renders flow anomaly alerts by metric and opens the project", () => {
    const alert = notification("flow_anomaly", {
      projectId: "p1",
      projectName: "Web",
      metric: "throughput",
      direction: "low",
      value: 2,
      baselineMedian: 14,
    });
    expect(getNotificationTitle(alert, t)).toBe(
      "notifications:events.flow_anomaly.title",
    );
    expect(getNotificationContent(alert, t)).toBe(
      "notifications:events.flow_anomaly.throughput_low",
    );
    expect(isSystemNotification(alert)).toBe(true);
    expect(getFlowAnomalyTarget(alert)).toEqual({ projectId: "p1" });
    expect(
      getFlowAnomalyTarget(notification("cycle_rollover", { projectId: "p1" })),
    ).toBeNull();
    const odd = notification("flow_anomaly", {
      metric: "wip",
      direction: "low",
    });
    expect(getNotificationContent({ ...odd, content: "stored" }, t)).toBe(
      "stored",
    );
  });

  it("falls back to the stored title and content for unknown types", () => {
    const item: NotificationTextSource = {
      type: "info",
      title: "Deploy finished",
      content: "All green",
      eventData: null,
    };
    expect(getNotificationTitle(item, t)).toBe("Deploy finished");
    expect(getNotificationContent(item, t)).toBe("All green");
    expect(getNotificationVerb(item, t)).toBe("Deploy finished");
  });
});

describe("inbox verbs", () => {
  it.each([
    ["task_created", {}, "notifications:inbox.verbs.task_created"],
    [
      "task_assignee_changed",
      {},
      "notifications:inbox.verbs.task_assignee_changed",
    ],
    ["task_comment", {}, "notifications:inbox.verbs.task_comment"],
    ["time_entry_created", {}, "notifications:inbox.verbs.time_entry_created"],
    ["task_overdue", {}, "notifications:inbox.verbs.task_overdue"],
    ["task_mention", {}, "notifications:inbox.verbs.task_mention"],
    [
      "task_mention",
      { source: "comment" },
      "notifications:inbox.verbs.task_mention_comment",
    ],
    [
      "task_updated",
      { field: "priority", newValue: "urgent" },
      "notifications:inbox.verbs.task_updated.priority(newValue=Urgent)",
    ],
    [
      "task_updated",
      { field: "dueDate", newValue: null },
      "notifications:inbox.verbs.task_updated.dueDateCleared",
    ],
    [
      "task_updated",
      { field: "title", newValue: "New" },
      "notifications:inbox.verbs.task_updated.title",
    ],
    [
      "due_date_reminder",
      { leadTimeMinutes: 1440 },
      "notifications:inbox.verbs.due_date_reminder(leadTime=1 days)",
    ],
  ])("%s %j", (type, eventData, expected) => {
    expect(getNotificationVerb(notification(type, eventData), t)).toBe(
      expected,
    );
  });

  it("formats a new due date", () => {
    expect(
      getNotificationVerb(
        notification("task_updated", {
          field: "dueDate",
          newValue: "2026-10-02T12:00:00.000Z",
        }),
        t,
      ),
    ).toMatch(
      /^notifications:inbox\.verbs\.task_updated\.dueDate\(newValue=.*2026\)$/,
    );
  });

  it("names the mentioned page, falling back when the title is missing", () => {
    const named = notification("page_mention", { pageTitle: "Release plan" });
    expect(getNotificationVerb(named, t)).toBe(
      "notifications:inbox.verbs.page_mention_titled(pageTitle=Release plan)",
    );
    expect(getPageMentionTitle(named)).toBe("Release plan");

    for (const eventData of [{}, { pageTitle: "  " }, { pageTitle: 3 }]) {
      const untitled = notification("page_mention", eventData);
      expect(getNotificationVerb(untitled, t)).toBe(
        "notifications:inbox.verbs.page_mention",
      );
      expect(getPageMentionTitle(untitled)).toBeNull();
    }
    expect(
      getPageMentionTitle(notification("task_mention", { pageTitle: "X" })),
    ).toBeNull();
  });
});

describe("actors", () => {
  it("prefers the joined actor, then names in the event data", () => {
    expect(
      getNotificationActorName(
        notification(
          "task_comment",
          { commenterName: "Mina" },
          { name: "Ana" },
        ),
      ),
    ).toBe("Ana");
    expect(
      getNotificationActorName(
        notification("task_comment", {
          actorName: "Ben",
          commenterName: "Mina",
        }),
      ),
    ).toBe("Ben");
    expect(
      getNotificationActorName(
        notification("task_comment", { commenterName: "Mina" }),
      ),
    ).toBe("Mina");
    expect(
      getNotificationActorName(
        notification("task_mention", { mentionerName: "Lu" }),
      ),
    ).toBe("Lu");
    expect(getNotificationActorName(notification("task_created", {}))).toBe(
      null,
    );
  });

  it("treats reminders and unknown types as system rows", () => {
    expect(isSystemNotification(notification("due_date_reminder", {}))).toBe(
      true,
    );
    expect(isSystemNotification(notification("task_overdue", {}))).toBe(true);
    expect(isSystemNotification(notification("info", {}))).toBe(true);
    expect(isSystemNotification(notification("task_comment", {}))).toBe(false);
  });

  it("renders an agent's answer as the agent's own row, with its text", () => {
    const item: NotificationTextSource = {
      type: "ai_agent_reply",
      title: "Maya answered your request",
      content: "The login timeout is set in auth.ts.",
      eventData: { runId: "r1", agentName: "Maya" },
      actor: { name: "Maya" },
    };
    expect(isSystemNotification(item)).toBe(false);
    expect(getNotificationActorName(item)).toBe("Maya");
    expect(getNotificationVerb(item, t)).toBe("ai:agents.reply.verb");
    expect(getNotificationTitle(item, t)).toBe("ai:agents.reply.title");
    expect(getNotificationContent(item, t)).toBe(
      "The login timeout is set in auth.ts.",
    );
  });
});
