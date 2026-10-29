import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { emailCopy, plural } from "./copy";
import NotificationEmail from "./notification";
import NotificationBatchEmail from "./notification-batch";
import NotificationDigestEmail, {
  type DigestWorkspace,
} from "./notification-digest";
import { emailLocales } from "./resolve-locale";

const nonEnglish = emailLocales.filter((locale) => locale !== "en");

const groups = [
  {
    id: "t1",
    title: "Launch plan",
    context: "Acme / Website",
    url: "https://margaya.example/task/1",
    changes: [
      { id: "n1", summary: "s", detail: "Moved to Done.", actorName: "Ada" },
      { id: "n2", summary: "s", detail: "Priority changed.", actorName: null },
    ],
  },
];

const workspace: DigestWorkspace = {
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
  mentionCount: 3,
  unreadCount: 4,
  brief: {
    blocked: [
      {
        title: "ENG-1 Fix login",
        url: "https://margaya.example/task/3",
        projectName: "Website",
        blockers: ["ENG-2"],
        hiddenBlockers: 1,
      },
    ],
    moreBlocked: 0,
    following: [
      {
        title: "ENG-4 Pricing",
        url: "https://margaya.example/task/4",
        projectName: "Website",
        changes: 5,
      },
    ],
    moreFollowing: 0,
  },
};

function renderAll(locale: string) {
  return Promise.all([
    render(
      createElement(NotificationEmail, {
        title: "Task assigned to you",
        message: "You were assigned to Launch plan.",
        actionUrl: "https://margaya.example/task/1",
        locale,
      }),
    ),
    render(
      createElement(NotificationBatchEmail, {
        groups,
        settingsUrl: "https://margaya.example/settings",
        locale,
      }),
    ),
    render(
      createElement(NotificationDigestEmail, {
        frequency: "weekly",
        workspaces: [workspace],
        settingsUrl: "https://margaya.example/settings",
        locale,
      }),
    ),
  ]);
}

// English chrome from each template; none may leak into another locale.
const englishChrome = [
  "You have a new Margaya notification",
  "A notification matched your delivery preferences.",
  "Open in Margaya",
  "Margaya notification",
  "new updates",
  "Changes on your tasks",
  "Open task",
  "Manage notification settings",
  "Your weekly digest",
  "Due soon and overdue",
  "Overdue",
  "and 2 more",
  "new mentions",
  "unread notifications",
  "Open inbox",
  "You chose to receive this digest.",
  "Blocked",
  "Waiting on",
  "1 task you can",
  "Changes on tasks you follow",
  "5 changes",
];

describe("notification emails in every locale", () => {
  it("covers every app locale", () => {
    expect(emailLocales).toHaveLength(20);
  });

  it("renders the English chrome for en", async () => {
    const text = (await renderAll("en-US")).join("\n");
    for (const phrase of englishChrome) {
      expect(text).toContain(phrase);
    }
  });

  it.each(nonEnglish)(
    "renders %s without falling back to English",
    async (locale) => {
      const [english, localized] = await Promise.all([
        renderAll("en"),
        renderAll(locale),
      ]);
      localized.forEach((text, index) => {
        expect(text).not.toBe(english[index]);
      });
      const text = localized.join("\n");
      for (const phrase of englishChrome) {
        expect(text).not.toContain(phrase);
      }
      // The data passes through untouched.
      expect(text).toContain("Launch plan");
      expect(text).toContain("ENG-2");
    },
  );

  it("uses the reader's plural forms", async () => {
    const [, ruBatch, ruDigest] = await renderAll("ru-RU");
    expect(ruBatch).toContain("2 новых обновления");
    expect(ruDigest).toContain("3 новых упоминания");
    expect(ruDigest).toContain("5 изменений");

    const [, plBatch, plDigest] = await renderAll("pl-PL");
    expect(plBatch).toContain("2 nowe aktualizacje");
    expect(plDigest).toContain("5 zmian");

    const [, , frDigest] = await renderAll("fr-FR");
    expect(frDigest).toContain("1 tâche que vous ne pouvez pas voir");
  });
});

describe("plural", () => {
  const group = {
    x_one: "{{count}} one",
    x_few: "{{count}} few",
    x_many: "{{count}} many",
    x_other: "{{count}} other",
  };

  it("follows CLDR rules per locale", () => {
    expect(plural(group, "x", "ru", 21)).toBe("21 one");
    expect(plural(group, "x", "ru", 22)).toBe("22 few");
    expect(plural(group, "x", "ru", 11)).toBe("11 many");
    expect(plural(group, "x", "pl", 21)).toBe("21 many");
    expect(plural(group, "x", "fr", 0)).toBe("0 one");
    expect(plural(group, "x", "ja", 1)).toBe("1 other");
  });

  it("falls back to other when a form is missing", () => {
    expect(plural({ x_one: "one", x_other: "other" }, "x", "ru", 5)).toBe(
      "other",
    );
  });

  // Every count the templates pluralise must have its own form for each
  // category the language uses, so nothing silently falls back to `other`.
  const families = [
    ["notificationBatch", "title"],
    ["notificationDigest", "more"],
    ["notificationDigest", "mentionsHeading"],
    ["notificationDigest", "unread"],
    ["notificationDigest", "hiddenBlockers"],
    ["notificationDigest", "changes"],
    ["batchSubject", "task"],
    ["batchSubject", "all"],
  ] as const;

  it.each(emailLocales)("has every plural form in %s", (locale) => {
    const copy = emailCopy(locale);
    const categories = new Intl.PluralRules(locale).resolvedOptions()
      .pluralCategories;
    for (const [group, key] of families) {
      const forms = copy[group] as Record<string, string>;
      for (const category of categories) {
        expect(
          forms[`${key}_${category}`],
          `${locale} ${group}.${key}_${category}`,
        ).toContain("{{count}}");
      }
    }
  });
});
