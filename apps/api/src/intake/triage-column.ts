import { and, eq, max } from "drizzle-orm";
import db from "../database";
import { columnTable } from "../database/schema";

// The project's one hidden triage column (B7 §2.4). Intake creates it on the
// first submission; the column API never creates, edits or deletes it.

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Transaction, "select">;

export const TRIAGE_COLUMN_NAME = "Triage";
export const TRIAGE_COLUMN_ICON = "Inbox";
const TRIAGE_SLUG = "triage";

/** The first free slug of `triage`, `triage-2`, `triage-3`, … */
export function pickTriageSlug(takenSlugs: Iterable<string>): string {
  const taken = new Set(takenSlugs);
  if (!taken.has(TRIAGE_SLUG)) return TRIAGE_SLUG;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${TRIAGE_SLUG}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export type TriageColumn = { id: string; slug: string };

export async function findTriageColumn(
  projectId: string,
  reader: Reader = db,
): Promise<TriageColumn | null> {
  const [column] = await reader
    .select({ id: columnTable.id, slug: columnTable.slug })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        eq(columnTable.group, "triage"),
      ),
    )
    .limit(1);
  return column ?? null;
}

/**
 * The project's triage column, created after the last column when missing.
 * The partial unique index makes a racing creation a no-op, so the select
 * that follows finds the winner's column.
 */
export async function ensureTriageColumn(
  tx: Transaction,
  projectId: string,
): Promise<TriageColumn> {
  const existing = await findTriageColumn(projectId, tx);
  if (existing) return existing;

  const columns = await tx
    .select({ slug: columnTable.slug })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId));
  const [last] = await tx
    .select({ position: max(columnTable.position) })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId));

  await tx
    .insert(columnTable)
    .values({
      projectId,
      name: TRIAGE_COLUMN_NAME,
      slug: pickTriageSlug(columns.map((column) => column.slug)),
      icon: TRIAGE_COLUMN_ICON,
      group: "triage",
      isFinal: false,
      position: (last?.position ?? -1) + 1,
    })
    .onConflictDoNothing();

  const created = await findTriageColumn(projectId, tx);
  if (!created) {
    throw new Error(`Failed to create the triage column of ${projectId}`);
  }
  return created;
}
