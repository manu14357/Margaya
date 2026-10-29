import { describe, expect, it } from "vitest";
import { workspaceDeletionEmailCopy } from "../../../apps/api/src/workspace-deletion/email-copy";
import { emailLocales } from "../../../packages/email/src/templates/resolve-locale";

const dueAt = "2026-11-28T09:00:00.000Z";

function render(locale: string | null, due: string | null = dueAt) {
  const { copy, date } = workspaceDeletionEmailCopy(locale, due);
  return {
    date,
    open: copy.openWorkspace,
    fallback: copy.fallbackName,
    scheduledSubject: copy.scheduledSubject("Acme"),
    scheduledTitle: copy.scheduledTitle("Acme", date),
    scheduledMessage: copy.scheduledMessage(date),
    cancelledSubject: copy.cancelledSubject("Acme"),
    cancelledTitle: copy.cancelledTitle("Acme"),
    cancelledMessage: copy.cancelledMessage,
  };
}

describe("workspaceDeletionEmailCopy", () => {
  it("keeps the English copy", () => {
    expect(render(null)).toEqual({
      date: "November 28, 2026",
      open: "Open workspace",
      fallback: "A workspace",
      scheduledSubject: "Acme is scheduled for deletion",
      scheduledTitle: "Acme will be deleted on November 28, 2026",
      scheduledMessage:
        "The owner scheduled this workspace for deletion. Until November 28, 2026 it is read-only: you can still open and export its work, and the owner can cancel the deletion. After that date its projects, tasks and pages are deleted for good.",
      cancelledSubject: "Acme will not be deleted",
      cancelledTitle: "Acme is back",
      cancelledMessage:
        "The owner cancelled the scheduled deletion. The workspace is no longer read-only, and its API keys and webhooks work again.",
    });
    const undated = render("en-US", "not a date");
    expect(undated.scheduledTitle).toBe("Acme will be deleted soon");
    expect(undated.scheduledMessage).toBe(
      "The owner scheduled this workspace for deletion. Until then it is read-only: you can still open and export its work, and the owner can cancel the deletion. After that its projects, tasks and pages are deleted for good.",
    );
  });

  it("formats the date in the reader's language", () => {
    expect(render("de-DE").scheduledTitle).toBe(
      "Acme wird am 28. November 2026 gelöscht",
    );
    expect(render("pt-BR").date).toBe("28 de novembro de 2026");
    expect(render("zh-CN").date).toBe("2026年11月28日");
  });

  it("translates every string for every email locale", () => {
    const english = render("en");
    const englishUndated = render("en", null);
    for (const locale of emailLocales.filter((code) => code !== "en")) {
      const localized = render(locale);
      const undated = render(locale, null);
      for (const key of Object.keys(english) as Array<keyof typeof english>) {
        expect(localized[key], `${locale} ${key}`).not.toBe(english[key]);
      }
      expect(localized.date, locale).toBeTruthy();
      expect(localized.scheduledTitle, locale).toContain(localized.date);
      expect(localized.scheduledMessage, locale).toContain(localized.date);
      expect(undated.scheduledTitle, locale).not.toBe(
        englishUndated.scheduledTitle,
      );
      expect(undated.scheduledMessage, locale).not.toMatch(/\bnull\b/);
      expect(localized.scheduledSubject, locale).toContain("Acme");
    }
  });
});
