import { sql } from "drizzle-orm";
import db from "../database";
import { projectPublicationTable, projectTable } from "../database/schema";

// B12 §2.9: projects public before publications existed get a publication
// whose link token is the project id, so every link shared before keeps
// working. Then `project.is_public` is repaired to mirror the publication
// both ways (drift from partial writes only). One transaction; each step
// matches only rows that still need it, so a second boot writes nothing.
// Raw SQL keeps `project.updated_at` untouched: a repair is not an edit.

export async function migratePublications() {
  const counts = await db.transaction(async (tx) => {
    const backfilled = await tx.execute(sql`
      INSERT INTO ${projectPublicationTable} (
        id, project_id, link_token, published_at, published_by, layouts,
        default_layout, comments_enabled, reactions_enabled, votes_enabled,
        requests_enabled, allow_guests, show_assignees, show_backlog
      )
      SELECT
        p.id, p.id, p.id, now(), NULL, '["board","list"]'::jsonb,
        'board', false, false, false, false, false, true, false
      FROM ${projectTable} AS p
      WHERE p.is_public = true
        AND NOT EXISTS (
          SELECT 1 FROM ${projectPublicationTable} AS pp
          WHERE pp.project_id = p.id
        )
      ON CONFLICT DO NOTHING
    `);
    const madePublic = await tx.execute(sql`
      UPDATE ${projectTable} AS p SET is_public = true
      FROM ${projectPublicationTable} AS pp
      WHERE pp.project_id = p.id
        AND pp.published_at IS NOT NULL
        AND p.is_public IS DISTINCT FROM true
    `);
    const madePrivate = await tx.execute(sql`
      UPDATE ${projectTable} AS p SET is_public = false
      FROM ${projectPublicationTable} AS pp
      WHERE pp.project_id = p.id
        AND pp.published_at IS NULL
        AND p.is_public = true
    `);
    return {
      backfilled: backfilled.rowCount ?? 0,
      madePublic: madePublic.rowCount ?? 0,
      madePrivate: madePrivate.rowCount ?? 0,
    };
  });
  if (counts.backfilled + counts.madePublic + counts.madePrivate > 0) {
    console.log(
      `Publication migration: backfilled ${counts.backfilled} boards, repaired ${counts.madePublic + counts.madePrivate} projects`,
    );
  }
  return counts;
}
