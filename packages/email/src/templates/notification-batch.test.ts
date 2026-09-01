import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import NotificationBatchEmail, { countChanges } from "./notification-batch";
import NotificationDigestEmail from "./notification-digest";

const groups = [
  {
    id: "t1",
    title: "Launch plan",
    context: "Acme / Website",
    url: "https://margaya.example/task/1",
    changes: [
      {
        id: "n1",
        summary: "Task status changed",
        detail: "Launch plan moved from To do to Done.",
        actorName: "Ada",
      },
      {
        id: "n2",
        summary: "Task updated",
        detail: "Priority of Launch plan changed to urgent.",
        actorName: null,
      },
    ],
  },
  {
    id: "t2",
    title: "Pricing page",
    context: "Acme / Website",
    url: "https://margaya.example/task/2",
    changes: [
      {
        id: "n3",
        summary: "Ben commented",
        detail: "New comment on Pricing page: ship it",
        actorName: "Ben",
      },
    ],
  },
];

describe("NotificationBatchEmail", () => {
  it("lists every change under its task with who made it", async () => {
    const element = createElement(NotificationBatchEmail, {
      groups,
      settingsUrl: "https://margaya.example/settings",
    });
    const html = await render(element);
    expect(html).toContain("3 new updates");
    expect(html).toContain("Launch plan moved from To do to Done.");
    expect(html).toContain("(by Ada)");
    expect(html).toContain("https://margaya.example/task/2");
    expect(html).toContain("Manage notification settings");

    const text = await render(element, { plainText: true });
    expect(text).toContain("Pricing page");
    expect(text).toContain("New comment on Pricing page: ship it");
    expect(text).not.toContain("<");
  });

  it("counts changes across groups", () => {
    expect(countChanges(groups)).toBe(3);
  });

  it("renders localized chrome", async () => {
    const html = await render(
      createElement(NotificationBatchEmail, {
        groups,
        settingsUrl: "https://margaya.example/settings",
        locale: "ja-JP",
      }),
    );
    expect(html).toContain("通知設定を管理");
  });
});

describe("NotificationDigestEmail", () => {
  it("renders due tasks, mentions and the unread count in html and text", async () => {
    const element = createElement(NotificationDigestEmail, {
      frequency: "weekly",
      settingsUrl: "https://margaya.example/settings",
      workspaces: [
        {
          name: "Acme",
          inboxUrl: "https://margaya.example/inbox",
          dueTasks: [
            {
              title: "Ship onboarding",
              url: "https://margaya.example/task/9",
              projectName: "Website",
              dueLabel: "Oct 12",
              overdue: true,
            },
          ],
          moreDueTasks: 2,
          mentions: [
            {
              id: "m1",
              title: "Ada mentioned you",
              detail: "You were mentioned in Launch plan.",
              url: null,
            },
          ],
          mentionCount: 1,
          unreadCount: 4,
        },
      ],
    });
    const html = await render(element);
    expect(html).toContain("Your weekly digest");
    expect(html).toContain("Overdue Oct 12");
    expect(html).toContain("and 2 more");
    expect(html).toContain("1 new mention");
    expect(html).toContain("4 unread notifications in your inbox");
    expect(html).toContain("Manage notification settings");

    const text = await render(element, { plainText: true });
    expect(text).toContain("Ship onboarding");
    expect(text).toContain("Manage notification settings");
  });
});
