import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { userTable } from "../../database/schema";
import type { z } from "../../openapi";
import {
  type UserPreferenceKey,
  type updateUserPreferencesBody,
  userPreferencesShape,
} from "../schema";

export type UserPreferences = z.infer<typeof updateUserPreferencesBody>;

/**
 * Keeps only known keys with valid values, so a stored value that a newer or
 * older client wrote never breaks a reader.
 */
export function cleanPreferences(stored: unknown): UserPreferences {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return {};
  }
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(userPreferencesShape) as UserPreferenceKey[]) {
    const value = (stored as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (userPreferencesShape[key].safeParse(value).success) clean[key] = value;
  }
  return clean as UserPreferences;
}

/** The stored preferences, null when the user never saved any. */
export async function getUserPreferences(userId: string) {
  const [row] = await db
    .select({ preferences: userTable.preferences })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "User not found" });
  return {
    preferences:
      row.preferences === null ? null : cleanPreferences(row.preferences),
  };
}

/** Merges the sent keys into the stored preferences in one statement. */
export async function updateUserPreferences(
  userId: string,
  patch: UserPreferences,
) {
  const changes = cleanPreferences(patch);
  const [row] = await db
    .update(userTable)
    .set({
      preferences: sql`coalesce(${userTable.preferences}, '{}'::jsonb) || ${JSON.stringify(changes)}::jsonb`,
    })
    .where(eq(userTable.id, userId))
    .returning({ preferences: userTable.preferences });
  if (!row) throw new HTTPException(404, { message: "User not found" });
  return { preferences: cleanPreferences(row.preferences) };
}
