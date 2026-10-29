import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

import {
  buildDeliveryContent,
  buildRecipientDeliveryContent,
} from "../../../apps/api/src/notification-preferences/delivery";
import { localizeNotificationText } from "../../../apps/api/src/notification-preferences/notification-text";
import { emailLocales } from "../../../packages/email/src/templates/resolve-locale";

type Source = Parameters<typeof buildDeliveryContent>[0];

function source(type: string, eventData: Record<string, unknown> | null) {
  return { type, title: null, content: null, eventData } satisfies Source;
}

const statusMove = source("task_status_changed", {
  taskTitle: "Design account notifications",
  oldStatus: "to-do",
  newStatus: "in-progress",
});

describe("buildRecipientDeliveryContent", () => {
  it("keeps the English wording byte for byte", () => {
    for (const locale of [null, "en", "en-US", "xx-YY"]) {
      expect(buildRecipientDeliveryContent(statusMove, locale)).toEqual({
        title: "Task status changed",
        body: "Design account notifications moved from to-do to in-progress.",
      });
    }
    const comment = source("task_comment", {
      taskTitle: "Draft",
      commenterName: "Ada",
      commentPreview: "Ship it",
    });
    expect(buildRecipientDeliveryContent(comment, "en-US")).toEqual(
      buildDeliveryContent(comment),
    );
  });

  it("translates a move between default columns for a German recipient", () => {
    expect(buildRecipientDeliveryContent(statusMove, "de-DE")).toEqual({
      title: "Aufgabenstatus geändert",
      body: 'Der Status der Aufgabe "Design account notifications" wurde von "Zu erledigen" zu "In Bearbeitung" geändert',
    });
  });

  it("translates a move between default columns for a Russian recipient", () => {
    expect(buildRecipientDeliveryContent(statusMove, "ru-RU")).toEqual({
      title: "Статус задачи изменён",
      body: "Статус задачи «Design account notifications» изменён с «К выполнению» на «В работе»",
    });
  });

  it("shows a custom column by its name, as the inbox does", () => {
    const custom = source("task_status_changed", {
      taskTitle: "Draft",
      oldStatus: "to-do",
      newStatus: "doing",
    });
    expect(buildRecipientDeliveryContent(custom, "de").body).toBe(
      'Der Status der Aufgabe "Draft" wurde von "Zu erledigen" zu "Doing" geändert',
    );
  });

  it("translates comments, priorities, mentions and reminders", () => {
    expect(
      buildRecipientDeliveryContent(
        source("task_comment", {
          taskTitle: "Draft",
          commenterName: "Ada",
          commentPreview: "Ship it",
        }),
        "de-DE",
      ),
    ).toEqual({
      title: "Ada hat deine Aufgabe kommentiert",
      body: "Neuer Kommentar zu „Draft“: Ship it",
    });
    expect(
      buildRecipientDeliveryContent(
        source("task_comment", { taskTitle: "Draft", commenterName: "Ada" }),
        "ru-RU",
      ).body,
    ).toBe("Новый комментарий к задаче «Draft»");
    expect(
      buildRecipientDeliveryContent(
        source("task_updated", {
          taskTitle: "Draft",
          field: "priority",
          oldValue: "low",
          newValue: "urgent",
        }),
        "ru-RU",
      ),
    ).toEqual({
      title: "Задача обновлена",
      body: "Приоритет задачи «Draft» изменён с Низкий на Срочный",
    });
    expect(
      buildRecipientDeliveryContent(
        source("task_mention", {
          taskTitle: "Draft",
          mentionerName: "Ada",
          source: "comment",
        }),
        "de-DE",
      ),
    ).toEqual({
      title: "Ada hat dich erwähnt",
      body: "Ada hat dich in einem Kommentar zu Draft erwähnt",
    });
    expect(
      buildRecipientDeliveryContent(
        source("due_date_reminder", {
          taskTitle: "Draft",
          leadTimeMinutes: 2880,
          dueDay: "2026-10-30",
        }),
        "ru-RU",
      ),
    ).toEqual({
      title: "Скоро срок выполнения задачи",
      body: "Срок задачи «Draft» наступит через 2 дня (30 окт. 2026 г.)",
    });
  });

  it("keeps free text as stored and falls back when data is missing", () => {
    const reply = {
      type: "ai_agent_reply",
      title: "Scout answered your request",
      content: "Here is the summary.",
      eventData: { agentName: "Scout", runId: "r1" },
    };
    expect(buildRecipientDeliveryContent(reply, "de-DE")).toEqual({
      title: "Scout hat auf deine Anfrage geantwortet",
      body: "Here is the summary.",
    });
    const adHoc = {
      type: "info",
      title: "Heads up",
      content: "Typed by a person",
      eventData: null,
    };
    expect(buildRecipientDeliveryContent(adHoc, "ru-RU")).toEqual({
      title: "Heads up",
      body: "Typed by a person",
    });
    // No statuses recorded: the English sentence rather than a broken one.
    const partial = source("task_status_changed", { taskTitle: "Draft" });
    expect(buildRecipientDeliveryContent(partial, "de-DE")).toEqual({
      title: "Aufgabenstatus geändert",
      body: "A task status changed in Margaya.",
    });
  });

  it("renders every non-English locale fully, without placeholders", () => {
    const english = buildRecipientDeliveryContent(statusMove, "en");
    for (const locale of emailLocales.filter((code) => code !== "en")) {
      const text = localizeNotificationText(statusMove, locale);
      expect(text?.title, locale).toBeTruthy();
      expect(text?.body, locale).toBeTruthy();
      expect(text?.body, locale).not.toBe(english.body);
      expect(`${text?.title} ${text?.body}`, locale).not.toMatch(/\{\{/u);
      expect(text?.body, locale).not.toContain("to-do");
    }
  });
});
