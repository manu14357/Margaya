import { describe, expect, it } from "vitest";
import { digestSubject } from "../../../apps/api/src/notification-email/digest-subject";
import { emailLocales } from "../../../packages/email/src/templates/resolve-locale";

describe("digestSubject", () => {
  it("keeps the English subjects", () => {
    expect(digestSubject("daily", null)).toBe("Your Margaya daily digest");
    expect(digestSubject("weekly", "en-US")).toBe("Your Margaya weekly digest");
    expect(digestSubject("daily", "xx-YY")).toBe("Your Margaya daily digest");
  });

  it("translates both frequencies for every email locale", () => {
    expect(digestSubject("daily", "de-DE")).toBe(
      "Deine tägliche Margaya-Zusammenfassung",
    );
    expect(digestSubject("weekly", "zh-CN")).toBe("你的 Margaya 每周摘要");
    for (const locale of emailLocales.filter((code) => code !== "en")) {
      const daily = digestSubject("daily", locale);
      const weekly = digestSubject("weekly", locale);
      expect(daily, locale).not.toBe(digestSubject("daily", "en"));
      expect(weekly, locale).not.toBe(digestSubject("weekly", "en"));
      expect(daily, locale).not.toBe(weekly);
      expect(daily, locale).toContain("Margaya");
    }
  });
});
