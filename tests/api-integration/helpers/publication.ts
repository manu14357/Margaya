import { eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import { migratePublications } from "../../../apps/api/src/migrations/publication-migration";

/**
 * Makes a project public the way installations upgraded to publications
 * do: the `isPublic` flag plus the boot backfill (link token = project id).
 * `false` unpublishes, keeping the publication row.
 */
export async function setProjectPublic(projectId: string, isPublic: boolean) {
  await db
    .update(schema.projectTable)
    .set({ isPublic })
    .where(eq(schema.projectTable.id, projectId));
  if (isPublic) {
    await migratePublications();
    return;
  }
  await db
    .update(schema.projectPublicationTable)
    .set({ publishedAt: null })
    .where(eq(schema.projectPublicationTable.projectId, projectId));
}
