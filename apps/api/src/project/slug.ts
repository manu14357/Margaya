import { and, eq, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type db from "../database";
import { projectTable } from "../database/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Serializes project writes that depend on per-workspace state (ordering and
// key uniqueness). `reorderProjects` takes the same lock with the same key.
export async function lockWorkspaceProjects(
  tx: Transaction,
  workspaceId: string,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(1524, hashtext(${workspaceId}))`,
  );
}

/**
 * Project keys prefix task identifiers (KEY-12), so they are unique per
 * workspace, ignoring case. Only the row being written is checked; existing
 * duplicates are left alone.
 */
export async function assertProjectSlugAvailable(
  tx: Transaction,
  workspaceId: string,
  slug: string,
  exceptProjectId?: string,
) {
  const [conflict] = await tx
    .select({ id: projectTable.id, deletedAt: projectTable.deletedAt })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        sql`lower(${projectTable.slug}) = lower(${slug})`,
        exceptProjectId ? ne(projectTable.id, exceptProjectId) : undefined,
      ),
    )
    .limit(1);

  // A trashed project keeps its key (C7), so its task keys stay unique when
  // it is restored.
  if (conflict?.deletedAt) {
    throw new HTTPException(409, {
      message: `A deleted project in the trash uses the key ${slug.toUpperCase()}. Restore it or delete it permanently first.`,
    });
  }
  if (conflict) {
    throw new HTTPException(409, {
      message: `A project with the key ${slug.toUpperCase()} already exists in this workspace`,
    });
  }
}
