import { and, eq, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import db from "../database";
import {
  activityTable,
  assetTable,
  pageTable,
  projectTable,
  taskTable,
} from "../database/schema";

// Before tasks or a project are deleted for good (C7): their files are shared
// by everything that links them, as a task copy keeps the links it was given
// and any text can show another task's file. A file other text of the
// workspace still links is handed to that text's task or page, so the cascade
// leaves it; the caller deletes the rest from storage. Like a purged page's
// files (page/assets.ts), a holder in the trash still counts: restoring it
// brings its files back, and its own purge hands them on again.

export type LeavingAsset = {
  id: string;
  objectKey: string;
  workspaceId: string;
  projectId: string;
};

/** What the delete takes with it, whose text holds nothing. */
export type Leaving = {
  taskIds?: readonly string[];
  pageIds?: readonly string[];
  projectId?: string;
};

type Holder = {
  taskId: string | null;
  pageId: string | null;
  projectId: string;
  surface: "description" | "comment" | "page";
  live: boolean;
  linked: string[];
};

const GROUP = 100;
const SURFACE_ORDER = { description: 0, comment: 1, page: 2 } as const;

const textArray = (values: readonly string[]) =>
  sql`${sql.param([...values])}::text[]`;

const linksAny = (column: AnyPgColumn, ids: readonly string[]) =>
  sql`${column} like any(${textArray(ids.map((id) => `%/api/asset/${id}%`))})`;

/** The asset ids a text links, read in the database to keep rows small. */
const linkedIds = (column: AnyPgColumn) =>
  sql<
    string[]
  >`array(select m[1] from regexp_matches(${column}, '/api/asset/([a-z0-9]+)', 'gi') as m)`;

/** Text of tasks, pages or a project that leave too holds nothing. */
function outside(
  leaving: Leaving,
  projectId: AnyPgColumn,
  own: { taskId?: AnyPgColumn; pageId?: AnyPgColumn },
) {
  const conditions: SQL[] = [];
  if (own.taskId && leaving.taskIds?.length) {
    conditions.push(
      sql`not (${own.taskId} = any(${textArray(leaving.taskIds)}))`,
    );
  }
  if (own.pageId && leaving.pageIds?.length) {
    conditions.push(
      sql`not (${own.pageId} = any(${textArray(leaving.pageIds)}))`,
    );
  }
  if (leaving.projectId) {
    conditions.push(sql`${projectId} <> ${leaving.projectId}`);
  }
  return conditions;
}

async function holdersOf(
  workspaceId: string,
  ids: string[],
  leaving: Leaving,
): Promise<Holder[]> {
  const taskLive = sql<boolean>`(${taskTable.deletedAt} is null and ${projectTable.deletedAt} is null)`;
  const [descriptions, comments, pages] = await Promise.all([
    db
      .select({
        taskId: taskTable.id,
        projectId: taskTable.projectId,
        live: taskLive,
        linked: linkedIds(taskTable.description),
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          linksAny(taskTable.description, ids),
          ...outside(leaving, taskTable.projectId, { taskId: taskTable.id }),
        ),
      ),
    db
      .select({
        taskId: taskTable.id,
        projectId: taskTable.projectId,
        live: taskLive,
        linked: linkedIds(activityTable.content),
      })
      .from(activityTable)
      .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          eq(activityTable.type, "comment"),
          linksAny(activityTable.content, ids),
          ...outside(leaving, taskTable.projectId, { taskId: taskTable.id }),
        ),
      ),
    db
      .select({
        pageId: pageTable.id,
        projectId: projectTable.id,
        live: sql<boolean>`(${pageTable.deletedAt} is null and ${projectTable.deletedAt} is null)`,
        linked: linkedIds(pageTable.contentMarkdown),
      })
      .from(pageTable)
      // A file needs a project; pages without one can't hold files yet.
      .innerJoin(projectTable, eq(projectTable.id, pageTable.projectId))
      .where(
        and(
          eq(pageTable.workspaceId, workspaceId),
          linksAny(pageTable.contentMarkdown, ids),
          ...outside(leaving, projectTable.id, { pageId: pageTable.id }),
        ),
      ),
  ]);
  return [
    ...descriptions.map((row) => ({
      ...row,
      pageId: null,
      surface: "description" as const,
    })),
    ...comments.map((row) => ({
      ...row,
      pageId: null,
      surface: "comment" as const,
    })),
    ...pages.map((row) => ({
      ...row,
      taskId: null,
      surface: "page" as const,
    })),
  ];
}

/** Live holders first, then the file's own project, then descriptions. */
function bestHolder(asset: LeavingAsset, holders: Holder[]) {
  const linking = holders.filter((holder) => holder.linked.includes(asset.id));
  linking.sort(
    (a, b) =>
      Number(b.live) - Number(a.live) ||
      Number(b.projectId === asset.projectId) -
        Number(a.projectId === asset.projectId) ||
      SURFACE_ORDER[a.surface] - SURFACE_ORDER[b.surface],
  );
  return linking[0];
}

/**
 * Hands each file that other text still links to that text's task or page.
 * Returns the files nothing else links, for the caller to delete from storage
 * once their rows are gone.
 */
export async function handOverAssets(
  assets: readonly LeavingAsset[],
  leaving: Leaving,
): Promise<LeavingAsset[]> {
  const orphans: LeavingAsset[] = [];
  const byWorkspace = new Map<string, LeavingAsset[]>();
  for (const asset of assets) {
    const group = byWorkspace.get(asset.workspaceId) ?? [];
    group.push(asset);
    byWorkspace.set(asset.workspaceId, group);
  }

  for (const [workspaceId, inWorkspace] of byWorkspace) {
    for (let start = 0; start < inWorkspace.length; start += GROUP) {
      const group = inWorkspace.slice(start, start + GROUP);
      const holders = await holdersOf(
        workspaceId,
        group.map((asset) => asset.id),
        leaving,
      );
      for (const asset of group) {
        const holder = bestHolder(asset, holders);
        if (!holder) {
          orphans.push(asset);
          continue;
        }
        // The surface follows the text that shows it now: the file never joins
        // the holder's attachments panel, and editing the link out of a
        // task's text cleans it up as usual.
        await db
          .update(assetTable)
          .set({
            taskId: holder.taskId,
            pageId: holder.pageId,
            projectId: holder.projectId,
            activityId: null,
            surface: holder.surface,
          })
          .where(eq(assetTable.id, asset.id));
      }
    }
  }
  return orphans;
}
