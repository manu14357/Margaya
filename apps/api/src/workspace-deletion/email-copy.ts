import {
  type EmailLocale,
  emailCopy,
  fill,
  resolveEmailLocale,
} from "@margaya/email";

// The emails members get when their workspace is scheduled for deletion or
// the deletion is cancelled, in each member's language. `date` is already
// formatted for the reader; it is null only when the event carried no valid
// due date.

export type DeletionEmailCopy = {
  /** Used when the event carries no workspace name. */
  fallbackName: string;
  openWorkspace: string;
  scheduledSubject: (name: string) => string;
  scheduledTitle: (name: string, date: string | null) => string;
  scheduledMessage: (date: string | null) => string;
  cancelledSubject: (name: string) => string;
  cancelledTitle: (name: string) => string;
  cancelledMessage: string;
};

function deletionCopy(locale: EmailLocale): DeletionEmailCopy {
  const c = emailCopy(locale).workspaceDeletion;
  return {
    fallbackName: c.fallbackName,
    openWorkspace: c.openWorkspace,
    scheduledSubject: (name) => fill(c.scheduledSubject, { name }),
    scheduledTitle: (name, date) =>
      date
        ? fill(c.scheduledTitle, { name, date })
        : fill(c.scheduledTitleNoDate, { name }),
    scheduledMessage: (date) =>
      date ? fill(c.scheduledMessage, { date }) : c.scheduledMessageNoDate,
    cancelledSubject: (name) => fill(c.cancelledSubject, { name }),
    cancelledTitle: (name) => fill(c.cancelledTitle, { name }),
    cancelledMessage: c.cancelledMessage,
  };
}

// Email locales are bare language codes; dates need the regional variant
// the app ships (en-US, pt-BR, zh-CN) to read as each locale expects.
const dateLocales: Partial<Record<EmailLocale, string>> = {
  en: "en-US",
  pt: "pt-BR",
  zh: "zh-CN",
};

/** The deletion email copy and date for one member's locale. */
export function workspaceDeletionEmailCopy(
  locale: string | null | undefined,
  dueAt?: string | null,
) {
  const resolved = resolveEmailLocale(locale);
  const date = dueAt ? new Date(dueAt) : null;
  return {
    copy: deletionCopy(resolved),
    date:
      date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString(dateLocales[resolved] ?? resolved, {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })
        : null,
  };
}
