import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { emailCopy } from "./copy";
import { emailLocales } from "./resolve-locale";
import TrialReminderEmail, { trialReminderTitle } from "./trial-reminder";

const english = emailCopy("en").trialReminder;

function renderReminder(locale: string, daysLeft: number) {
  return render(
    createElement(TrialReminderEmail, {
      workspaceName: "Acme",
      daysLeft,
      billingUrl: "https://margaya.example/billing",
      locale,
    }),
  );
}

describe("TrialReminderEmail", () => {
  it.each(emailLocales)("renders %s copy, not English", async (locale) => {
    const copy = emailCopy(locale).trialReminder;
    const active = await renderReminder(locale, 3);
    const ended = await renderReminder(locale, 0);

    expect(active).toContain(copy.cta);
    // React escapes apostrophes (fr, it) in the rendered HTML.
    const html = (text: string) => text.replaceAll("'", "&#x27;");
    expect(active).toContain(html(trialReminderTitle(locale, "Acme", 3)));
    expect(ended).toContain(html(trialReminderTitle(locale, "Acme", 0)));
    expect(trialReminderTitle(locale, "Acme", 3)).not.toContain("{{");
    expect(trialReminderTitle(locale, "Acme", 0)).not.toContain("{{");
    if (locale !== "en") {
      expect(copy.cta).not.toBe(english.cta);
      expect(copy.selfHost).not.toBe(english.selfHost);
      expect(copy.footer).not.toBe(english.footer);
      expect(copy.endedSubtitle).not.toBe(english.endedSubtitle);
      expect(copy.activeSubtitle).not.toBe(english.activeSubtitle);
      expect(trialReminderTitle(locale, "Acme", 0)).not.toBe(
        trialReminderTitle("en", "Acme", 0),
      );
      expect(trialReminderTitle(locale, "Acme", 3)).not.toBe(
        trialReminderTitle("en", "Acme", 3),
      );
    }
  });

  it.each(emailLocales)(
    "has a form for every plural category in %s",
    (locale) => {
      const forms: Record<string, unknown> = emailCopy(locale).trialReminder;
      const rules = new Intl.PluralRules(locale);
      for (const category of rules.resolvedOptions().pluralCategories) {
        expect(
          `daysLeftTitle_${category}` in forms,
          `${locale} needs daysLeftTitle_${category}`,
        ).toBe(true);
      }
      for (let n = 1; n <= 200; n++) {
        const title = trialReminderTitle(locale, "Acme", n);
        expect(title).toContain(String(n));
        expect(title).toContain("Acme");
        expect(title).not.toContain("{{");
      }
    },
  );

  it("counts days in English", () => {
    expect(trialReminderTitle("en", "Acme", 1)).toBe(
      "1 day left on your Acme trial",
    );
    expect(trialReminderTitle("en", "Acme", 3)).toBe(
      "3 days left on your Acme trial",
    );
    expect(trialReminderTitle("en", "Acme", 0)).toBe(
      "The trial for Acme has ended",
    );
  });

  it("uses the Russian one, few and many forms", () => {
    const title = (n: number) => trialReminderTitle("ru", "Acme", n);
    expect(title(1)).toContain("остался 1 день");
    expect(title(21)).toContain("остался 21 день");
    expect(title(2)).toContain("осталось 2 дня");
    expect(title(3)).toContain("осталось 3 дня");
    expect(title(24)).toContain("осталось 24 дня");
    expect(title(5)).toContain("осталось 5 дней");
    expect(title(11)).toContain("осталось 11 дней");
    expect(title(14)).toContain("осталось 14 дней");
  });

  it("uses the Polish one, few and many forms", () => {
    const title = (n: number) => trialReminderTitle("pl", "Acme", n);
    expect(title(1)).toContain("został 1 dzień");
    expect(title(2)).toContain("zostały 2 dni");
    expect(title(4)).toContain("zostały 4 dni");
    expect(title(22)).toContain("zostały 22 dni");
    expect(title(5)).toContain("zostało 5 dni");
    expect(title(12)).toContain("zostało 12 dni");
    expect(title(21)).toContain("zostało 21 dni");
  });

  it("uses the Ukrainian and Macedonian forms", () => {
    expect(trialReminderTitle("uk", "Acme", 1)).toContain("залишився 1 день");
    expect(trialReminderTitle("uk", "Acme", 3)).toContain("залишилося 3 дні");
    expect(trialReminderTitle("uk", "Acme", 7)).toContain("залишилося 7 днів");
    expect(trialReminderTitle("mk", "Acme", 1)).toContain("Уште 1 ден");
    expect(trialReminderTitle("mk", "Acme", 21)).toContain("Уште 21 ден");
    expect(trialReminderTitle("mk", "Acme", 11)).toContain("Уште 11 дена");
    expect(trialReminderTitle("mk", "Acme", 3)).toContain("Уште 3 дена");
  });

  it("fills the count before the name", () => {
    expect(trialReminderTitle("en", "{{count}} Co", 2)).toBe(
      "2 days left on your {{count}} Co trial",
    );
  });

  it("resolves a region tag and falls back to English", async () => {
    expect(await renderReminder("pt-BR", 3)).toContain(
      emailCopy("pt").trialReminder.cta,
    );
    expect(await renderReminder("xx-YY", 3)).toContain(english.cta);
  });
});
