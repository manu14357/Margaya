import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));
vi.mock("@margaya/email", async () => ({
  ...(await import("../../../packages/email/src/templates/resolve-locale")),
  ...(await import("../../../packages/email/src/templates/copy")),
  isSmtpConfigured: () => false,
  sendTrialReminderEmail: vi.fn(),
}));

const { emailLocales } = await import(
  "../../../packages/email/src/templates/resolve-locale"
);
const { trialReminderSubject } = await import(
  "../../../apps/api/src/scheduler/trial-reminders"
);

describe("trialReminderSubject", () => {
  it("keeps the English subjects", () => {
    expect(trialReminderSubject("trial_ending", "Acme", "en-US")).toBe(
      "Your Acme trial ends in 3 days",
    );
    expect(trialReminderSubject("trial_expired", "Acme", null)).toBe(
      "Your Acme trial has ended",
    );
  });

  it.each(emailLocales)("translates both subjects into %s", (locale) => {
    for (const type of ["trial_ending", "trial_expired"] as const) {
      const subject = trialReminderSubject(type, "Acme", locale);
      expect(subject).toContain("Acme");
      expect(subject).not.toContain("{{");
      if (locale !== "en") {
        expect(subject).not.toBe(trialReminderSubject(type, "Acme", "en"));
      }
    }
  });

  it("uses the right plural for three days", () => {
    expect(trialReminderSubject("trial_ending", "Acme", "ru-RU")).toContain(
      "через 3 дня",
    );
    expect(trialReminderSubject("trial_ending", "Acme", "pl-PL")).toContain(
      "za 3 dni",
    );
    expect(trialReminderSubject("trial_ending", "Acme", "uk-UA")).toContain(
      "через 3 дні",
    );
  });
});
