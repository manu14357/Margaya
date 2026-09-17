import { eq, inArray } from "drizzle-orm";
import db from "../database";
import { instanceSettingTable, userTable } from "../database/schema";
import { type SettingValue, settingDefinition } from "./catalog";
import type { StoredSetting } from "./resolve";
import { openInstanceSecret, sealInstanceSecret } from "./secret";

const warnedUnreadable = new Set<string>();

/** Every stored row, secrets decrypted. Unreadable secrets carry no value. */
export async function loadSettingRows(): Promise<StoredSetting[]> {
  const rows = await db
    .select({
      key: instanceSettingTable.key,
      value: instanceSettingTable.value,
      secret: instanceSettingTable.secret,
      updatedAt: instanceSettingTable.updatedAt,
      updatedById: instanceSettingTable.updatedBy,
      updatedByName: userTable.name,
    })
    .from(instanceSettingTable)
    .leftJoin(userTable, eq(userTable.id, instanceSettingTable.updatedBy));

  return rows.map((row) => {
    const updatedBy =
      row.updatedById && row.updatedByName !== null
        ? { id: row.updatedById, name: row.updatedByName }
        : null;
    if (row.secret === null) {
      return {
        key: row.key,
        value: row.value ?? null,
        unreadable: false,
        updatedAt: row.updatedAt,
        updatedBy,
      };
    }
    const plaintext = openInstanceSecret(row.secret);
    if (plaintext === null && !warnedUnreadable.has(row.key)) {
      warnedUnreadable.add(row.key);
      console.warn(
        `Instance setting ${row.key} can't be decrypted (AUTH_SECRET changed?); using the environment or default instead.`,
      );
    }
    return {
      key: row.key,
      value: plaintext,
      unreadable: plaintext === null,
      updatedAt: row.updatedAt,
      updatedBy,
    };
  });
}

/** A validated change: a value to store, or null to clear the saved value. */
export type SettingChange = { key: string; value: SettingValue | null };

/** Applies every change in one transaction. */
export async function writeSettingChanges(
  changes: readonly SettingChange[],
  userId: string,
): Promise<void> {
  const cleared = changes
    .filter((change) => change.value === null)
    .map((change) => change.key);
  const stored = changes.filter(
    (change): change is { key: string; value: SettingValue } =>
      change.value !== null,
  );

  await db.transaction(async (tx) => {
    if (cleared.length > 0) {
      await tx
        .delete(instanceSettingTable)
        .where(inArray(instanceSettingTable.key, cleared));
    }
    for (const change of stored) {
      const secret = settingDefinition(change.key)?.secret === true;
      const row = secret
        ? { value: null, secret: sealInstanceSecret(String(change.value)) }
        : { value: change.value, secret: null };
      await tx
        .insert(instanceSettingTable)
        .values({ key: change.key, ...row, updatedBy: userId })
        .onConflictDoUpdate({
          target: instanceSettingTable.key,
          set: { ...row, updatedBy: userId, updatedAt: new Date() },
        });
    }
  });
  for (const key of changes.map((change) => change.key)) {
    warnedUnreadable.delete(key);
  }
}
