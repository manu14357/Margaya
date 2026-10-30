import { sql } from "drizzle-orm";
import db from "../../../apps/api/src/database";

/**
 * Runs `fn` while inserting a reply under `parentId` deletes that parent
 * first, inside the insert itself. The API has already found the parent by
 * then, so this replays "deleted between the check and the insert"
 * deterministically: the insert then breaks the parent foreign key.
 */
export async function withParentDeletedOnReply<T>(
  parentId: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Ids are generated text without quotes; refuse anything else.
  if (!/^[\w-]+$/.test(parentId)) throw new Error("unexpected id");
  await db.execute(
    sql.raw(`
      CREATE OR REPLACE FUNCTION test_delete_reply_parent() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.parent_id = '${parentId}' THEN
          DELETE FROM activity WHERE id = NEW.parent_id;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_delete_reply_parent BEFORE INSERT ON activity
        FOR EACH ROW EXECUTE FUNCTION test_delete_reply_parent();
    `),
  );
  try {
    return await fn();
  } finally {
    await db.execute(
      sql.raw(`
        DROP TRIGGER IF EXISTS test_delete_reply_parent ON activity;
        DROP FUNCTION IF EXISTS test_delete_reply_parent();
      `),
    );
  }
}
