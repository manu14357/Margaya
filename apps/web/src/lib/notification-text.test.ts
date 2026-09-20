import { describe, expect, it } from "vitest";
import {
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
});
