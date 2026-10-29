import { emailCopy } from "@margaya/email";

/** The digest's subject line, in the reader's language. */
export function digestSubject(
  frequency: "daily" | "weekly",
  locale: string | null,
) {
  return emailCopy(locale).digestSubject[frequency];
}
