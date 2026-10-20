import { eq } from "drizzle-orm";
import db from "../database";
import { userTable } from "../database/schema";

// The reader's UI locale decides the answer language of AI features.

const FALLBACK_LOCALE = "en-US";

/** The user's UI locale ("de-DE"); en-US when unset. */
export async function userLocale(userId: string): Promise<string> {
  const [user] = await db
    .select({ locale: userTable.locale })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return user?.locale?.trim() || FALLBACK_LOCALE;
}

/** The language part of a locale: "pt-BR" → "pt". */
export function baseLanguage(locale: string): string {
  return (locale.split(/[-_]/)[0] ?? "en").toLowerCase();
}
