import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { emailLocales } from "./resolve-locale";
import TestEmail, { testEmailSubject, testEmailText } from "./test-email";

describe("TestEmail", () => {
  it.each(emailLocales)("renders %s copy, not English", async (locale) => {
    const html = await render(
      createElement(TestEmail, { instanceName: "Acme", locale }),
    );
    const subject = testEmailSubject("Acme", locale);
    const text = testEmailText("Acme", locale);

    expect(subject).toContain("Acme");
    expect(text).toContain("Acme");
    expect(subject).not.toContain("{{");
    expect(text).not.toContain("{{");
    // React escapes apostrophes (fr, it) in the rendered HTML.
    expect(html).toContain(text.replaceAll("'", "&#x27;"));
    if (locale !== "en") {
      expect(subject).not.toBe(testEmailSubject("Acme", "en"));
      expect(text).not.toBe(testEmailText("Acme", "en"));
    }
  });

  it("falls back to English without a locale", () => {
    expect(testEmailSubject("Acme")).toBe("Test email from Acme");
    expect(testEmailSubject("Acme", "xx")).toBe("Test email from Acme");
    expect(testEmailSubject("Acme", "de-DE")).toBe("Test-E-Mail von Acme");
  });

  it("keeps the English body", () => {
    expect(testEmailText("Acme", "en-US")).toBe(
      "This is a test email from Acme. If you can read it, email delivery works.",
    );
  });
});
