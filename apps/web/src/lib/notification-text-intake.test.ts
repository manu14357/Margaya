import { describe, expect, it } from "vitest";
import {
  getIntakeNotificationTarget,
  getNotificationContent,
  getNotificationTitle,
  getNotificationVerb,
  isSystemNotification,
  type NotificationTextSource,
} from "./notification-text";

const t = (key: string, options?: Record<string, unknown>) => {
  const values = ["taskKey", "columnName", "note", "duplicateKey"]
    .filter((name) => options?.[name])
    .map((name) => `${name}=${options?.[name]}`);
  return values.length > 0 ? `${key}(${values.join(",")})` : key;
};

function notification(
  type: string,
  eventData: Record<string, unknown>,
): NotificationTextSource {
  return {
    type,
    title: "stored title",
    content: "stored content",
    eventData,
    actor: { name: "Ben" },
  };
}

const base = {
  intakeItemId: "item-1",
  taskTitle: "Export fails",
  taskKey: "web-42",
  projectId: "p1",
  workspaceId: "ws",
};

describe("intake notification text", () => {
  it("reads as a person's action with its own title and verb", () => {
    const accepted = notification("intake_accepted", {
      ...base,
      columnName: "To Do",
    });
    expect(isSystemNotification(accepted)).toBe(false);
    expect(getNotificationTitle(accepted, t)).toMatch(
      /^notifications:events.intake_accepted.title/,
    );
    expect(getNotificationVerb(accepted, t)).toBe(
      "notifications:inbox.verbs.intake_accepted",
    );
  });

  it("names the column, or the backlog, with an upper-case key", () => {
    expect(
      getNotificationContent(
        notification("intake_accepted", { ...base, columnName: "To Do" }),
        t,
      ),
    ).toBe(
      "notifications:events.intake_accepted.content(taskKey=WEB-42,columnName=To Do)",
    );
    expect(
      getNotificationContent(
        notification("intake_accepted", { ...base, columnName: null }),
        t,
      ),
    ).toBe(
      "notifications:events.intake_accepted.contentBacklog(taskKey=WEB-42)",
    );
  });

  it("includes the decline reason when there is one", () => {
    expect(
      getNotificationContent(
        notification("intake_declined", { ...base, note: "Out of scope" }),
        t,
      ),
    ).toBe(
      "notifications:events.intake_declined.contentWithReason(taskKey=WEB-42,note=Out of scope)",
    );
    expect(
      getNotificationContent(
        notification("intake_declined", { ...base, note: null }),
        t,
      ),
    ).toBe("notifications:events.intake_declined.content(taskKey=WEB-42)");
  });

  it("points at the covering task of a duplicate", () => {
    expect(
      getNotificationContent(
        notification("intake_duplicate", { ...base, duplicateKey: "web-7" }),
        t,
      ),
    ).toBe(
      "notifications:events.intake_duplicate.content(taskKey=WEB-42,duplicateKey=WEB-7)",
    );
  });
});

describe("getIntakeNotificationTarget", () => {
  it("opens declined and duplicate requests in their queue", () => {
    expect(
      getIntakeNotificationTarget(notification("intake_declined", base)),
    ).toEqual({ projectId: "p1", itemId: "item-1" });
    expect(
      getIntakeNotificationTarget(notification("intake_duplicate", base)),
    ).toEqual({ projectId: "p1", itemId: "item-1" });
  });

  it("leaves accepted requests and other types to the task link", () => {
    expect(
      getIntakeNotificationTarget(notification("intake_accepted", base)),
    ).toBeNull();
    expect(
      getIntakeNotificationTarget(notification("task_comment", base)),
    ).toBeNull();
    expect(
      getIntakeNotificationTarget(
        notification("intake_declined", { taskTitle: "x" }),
      ),
    ).toBeNull();
  });
});
