import { createHash, randomUUID } from "node:crypto";
import db, { schema } from "../../../apps/api/src/database";

type User = { id: string };

/**
 * An API key of `user`, stored as Better Auth stores it (SHA-256, base64url).
 * Without `permissions` the key carries its owner's full role; with them, it
 * must also satisfy those statements.
 */
export async function createApiKey(
  user: User,
  permissions?: Record<string, string[]>,
) {
  const key = `margaya_test_${randomUUID()}`;
  const [row] = await db
    .insert(schema.apikeyTable)
    .values({
      referenceId: user.id,
      userId: user.id,
      key: createHash("sha256").update(key).digest("base64url"),
      name: "test key",
      createdAt: new Date(),
      updatedAt: new Date(),
      permissions: permissions ? JSON.stringify(permissions) : null,
      enabled: true,
    })
    .returning({ id: schema.apikeyTable.id });
  if (!row) throw new Error("Failed to create API key");
  return { id: row.id, key, headers: { Authorization: `Bearer ${key}` } };
}
