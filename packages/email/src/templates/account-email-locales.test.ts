import { render } from "@react-email/render";
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { OTP_EXPIRY_SECONDS } from "../otp-expiry";
import { emailCopy, fill } from "./copy";
import EmailChangedEmail from "./email-changed";
import MagicLinkEmail from "./magic-link";
import type { EmailMessages } from "./messages.generated";
import OtpEmail from "./otp";
import PasswordResetEmail from "./password-reset";
import { type EmailLocale, emailLocales } from "./resolve-locale";

/** React's escaping of text content, so copy can be matched in the HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

type AccountGroup = "otp" | "magicLink" | "passwordReset" | "emailChanged";

/** A template, built for a locale, and the copy it must render. */
function template<G extends AccountGroup>(
  group: G,
  build: (locale: string) => ReactElement,
  rendered: (copy: EmailMessages[G]) => string[],
) {
  return [
    group,
    build,
    (locale: EmailLocale) => rendered(emailCopy(locale)[group]),
  ] as const;
}

const templates = [
  template(
    "otp",
    (locale) => createElement(OtpEmail, { otp: "123456", locale }),
    (copy) => [
      copy.title,
      copy.subtitle,
      copy.code,
      fill(copy.expiry, { minutes: OTP_EXPIRY_SECONDS / 60 }),
      copy.ignore,
      copy.footer,
    ],
  ),
  template(
    "magicLink",
    (locale) =>
      createElement(MagicLinkEmail, {
        magicLink: "https://margaya.example/auth",
        locale,
      }),
    (copy) => [
      copy.title,
      copy.subtitle,
      copy.cta,
      copy.expiry,
      copy.ignore,
      copy.footer,
    ],
  ),
  template(
    "passwordReset",
    (locale) =>
      createElement(PasswordResetEmail, {
        resetLink: "https://margaya.example/reset",
        userName: "Jane",
        locale,
      }),
    (copy) => [
      copy.title,
      fill(copy.subtitleWithName, { name: "Jane" }),
      copy.cta,
      copy.expiry,
      copy.ignore,
      copy.footer,
    ],
  ),
  template(
    "emailChanged",
    (locale) =>
      createElement(EmailChangedEmail, {
        newEmail: "j***@example.com",
        locale,
      }),
    (copy) => [
      copy.title,
      fill(copy.body, { email: "j***@example.com" }),
      copy.warning,
      copy.footer,
    ],
  ),
];

const english = emailCopy("en");

describe.each(templates)("%s email", (_group, build, rendered) => {
  it.each(emailLocales)("renders the %s copy", async (locale) => {
    const html = await render(build(locale));
    for (const text of rendered(locale)) {
      expect(html).toContain(escapeHtml(text));
    }
  });

  it.each(emailLocales.filter((locale) => locale !== "en"))(
    "does not fall back to English for %s",
    async (locale) => {
      const html = await render(build(locale));
      for (const text of rendered("en")) {
        expect(html).not.toContain(escapeHtml(text));
      }
    },
  );
});

describe("account email copy", () => {
  const groups = [
    ...templates.map(([group]) => group),
    "authSubjects",
  ] as const;

  it.each(
    emailLocales
      .filter((locale) => locale !== "en")
      .flatMap((locale) => groups.map((group) => [locale, group] as const)),
  )("%s translates every %s string", (locale: EmailLocale, group) => {
    const copy: Record<string, string> = emailCopy(locale)[group];
    const englishCopy: Record<string, string> = english[group];
    expect(Object.keys(copy)).toEqual(Object.keys(englishCopy));
    for (const [key, text] of Object.entries(copy)) {
      expect(text, key).not.toBe(englishCopy[key]);
    }
  });

  it.each(emailLocales)("keeps the English placeholders in %s", (locale) => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]);
    for (const group of groups) {
      const copy: Record<string, string> = emailCopy(locale)[group];
      const englishCopy: Record<string, string> = english[group];
      for (const [key, text] of Object.entries(copy)) {
        expect(placeholders(text), `${group}.${key}`).toEqual(
          placeholders(englishCopy[key] ?? ""),
        );
      }
    }
  });
});
