import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";

// Margaya starts from a single baseline migration, so there is no legacy
// upgrade path to repair. These checks pin the ownership and archival
// invariants that the baseline schema must establish on a fresh database.
beforeEach(async () => {
  await resetTestDatabase();
});

type Row = Record<string, unknown>;

async function rows(query: ReturnType<typeof sql>) {
  const result = await db.execute(query);
  return (result as unknown as { rows: Row[] }).rows;
}

describe("baseline ownership and archival schema", () => {
  it("requires every API key to reference an owning user", async () => {
    const [column] = await rows(sql`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'apikey' AND column_name = 'reference_id'
    `);
    expect(column).toMatchObject({ is_nullable: "NO" });
  });

  it("deletes a user's API keys together with the user", async () => {
    const [constraint] = await rows(sql`
      SELECT rc.delete_rule
      FROM information_schema.referential_constraints rc
      WHERE rc.constraint_name = 'apikey_reference_id_user_id_fk'
    `);
    expect(constraint).toMatchObject({ delete_rule: "CASCADE" });
  });

  it("supports archiving projects", async () => {
    const [column] = await rows(sql`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'project' AND column_name = 'archived_at'
    `);
    expect(column).toMatchObject({
      data_type: "timestamp without time zone",
    });
  });
});
