import {
  type EmailMessages,
  emailMessagesFor,
  type NotificationTexts,
  notificationTextsFor,
} from "./messages.generated";
import { type EmailLocale, resolveEmailLocale } from "./resolve-locale";

/** The email copy for a user's locale (any form: "de-DE", "pt", null). */
export function emailCopy(locale?: string | null): EmailMessages {
  return emailMessagesFor(resolveEmailLocale(locale));
}

/**
 * The web app's notification strings (events, status and priority names)
 * for a user's locale, so emails word a notification as the inbox does.
 */
export function notificationCopy(locale?: string | null): NotificationTexts {
  return notificationTextsFor(resolveEmailLocale(locale));
}

/** Fills i18next-style `{{name}}` placeholders. */
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/gu, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * The plural form of `key` for `count`, i18next style: `daysLeft_one`,
 * `daysLeft_few`, … picked by Intl.PluralRules, falling back to `_other`.
 */
export function plural(
  group: object,
  key: string,
  locale: EmailLocale,
  count: number,
): string {
  const forms = group as Record<string, string | undefined>;
  const category = new Intl.PluralRules(locale).select(count);
  const form = forms[`${key}_${category}`] ?? forms[`${key}_other`];
  if (form === undefined) {
    throw new Error(`Missing plural form ${key}_other`);
  }
  return fill(form, { count });
}
