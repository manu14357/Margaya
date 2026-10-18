import { sql } from "drizzle-orm";
import db from "../database";
import { withJobLease } from "../scheduler/leader-lock";

// Fills `search_tsv` for rows written before migration 0032 added it.
// Triggers keep new and edited rows current; this walks the rest in small
// batches so a large install never holds one long write lock, and search
// matches the rows still pending through the partial "pending" indexes in the
// meantime (search/text-query.ts, `indexedMatch`). Each batch matches only
// rows that are still NULL, so a second run, or a run on another instance
// after a lease expires, writes nothing twice. Raw SQL leaves `updated_at`
// alone: indexing is not an edit.

const BATCH_SIZE = 500;
const LEASE = "search-index-backfill";

const TABLES = [
  {
    name: "task",
    batch: sql`
      UPDATE task SET search_tsv = margaya_task_search_tsv(title, description, project_id, number)
      WHERE id IN (
        SELECT id FROM task WHERE search_tsv IS NULL
        LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
      )`,
  },
  {
    name: "page",
    batch: sql`
      UPDATE page SET search_tsv = margaya_page_search_tsv(title, content_text)
      WHERE id IN (
        SELECT id FROM page WHERE search_tsv IS NULL
        LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
      )`,
  },
  {
    name: "comment",
    batch: sql`
      UPDATE activity SET search_tsv = margaya_comment_search_tsv(content)
      WHERE id IN (
        SELECT id FROM activity
        WHERE type = 'comment' AND search_tsv IS NULL
        LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
      )`,
  },
] as const;

export type SearchBackfillResult = Record<
  (typeof TABLES)[number]["name"],
  number
>;

/** Indexes every pending row now, in batches; returns rows indexed per kind. */
export async function backfillSearchIndex(): Promise<SearchBackfillResult> {
  const counts = { task: 0, page: 0, comment: 0 };
  for (const table of TABLES) {
    for (;;) {
      const result = await db.execute(table.batch);
      const updated = result.rowCount ?? 0;
      counts[table.name] += updated;
      if (updated < BATCH_SIZE) break;
    }
  }
  return counts;
}

/**
 * The boot and hourly job: one instance at a time. Once everything is
 * indexed, each pass is three index lookups on empty partial indexes.
 */
export async function runSearchIndexBackfill(): Promise<void> {
  await withJobLease(
    LEASE,
    async () => {
      const counts = await backfillSearchIndex();
      const total = counts.task + counts.page + counts.comment;
      if (total > 0) {
        console.log(
          `Search index backfill: ${counts.task} tasks, ${counts.page} pages, ${counts.comment} comments`,
        );
      }
    },
    () => undefined,
    60 * 60 * 1000,
  );
}
