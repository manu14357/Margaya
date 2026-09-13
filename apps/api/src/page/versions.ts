import { jsonToMarkdown, type PageDocument } from "@margaya/editor-schema";
import { desc, eq, inArray } from "drizzle-orm";
import { pageVersionTable } from "../database/schema";
import type { PageRecord, Transaction } from "./controllers/shared";
import { versionAction, versionsBeyondLimit } from "./rules";

// Version tracking (K8, §2.2), inside the persist transaction.

async function trimVersions(tx: Transaction, pageId: string) {
  const rows = await tx
    .select({ id: pageVersionTable.id })
    .from(pageVersionTable)
    .where(eq(pageVersionTable.pageId, pageId))
    .orderBy(desc(pageVersionTable.lastSavedAt), desc(pageVersionTable.id));
  const excess = versionsBeyondLimit(rows.map((row) => row.id));
  if (excess.length > 0) {
    await tx
      .delete(pageVersionTable)
      .where(inArray(pageVersionTable.id, excess));
  }
}

/** A new, never-coalesced version of the content before a restore. */
export async function insertForcedVersion(
  tx: Transaction,
  {
    page,
    json,
    actorId,
    savedAt,
  }: {
    page: PageRecord;
    json: PageDocument;
    actorId: string | null;
    savedAt: Date;
  },
) {
  await tx.insert(pageVersionTable).values({
    pageId: page.id,
    workspaceId: page.workspaceId,
    ownerId: actorId,
    contributorIds: actorId ? [actorId] : [],
    title: page.title,
    contentJson: json,
    contentMarkdown: jsonToMarkdown(json),
    lastSavedAt: savedAt,
    createdAt: savedAt,
  });
  await trimVersions(tx, page.id);
}

/**
 * Records the content of a persist that changed it: updates the newest
 * version when it is the same user's within 10 minutes, otherwise inserts
 * one, then keeps the newest 20.
 */
export async function trackPageVersion(
  tx: Transaction,
  {
    page,
    json,
    markdown,
    actorId,
    contributorIds,
    forceNew,
    now,
  }: {
    page: PageRecord;
    json: PageDocument;
    markdown: string;
    actorId: string | null;
    contributorIds: string[];
    forceNew: boolean;
    now: Date;
  },
) {
  const [newest] = await tx
    .select({
      id: pageVersionTable.id,
      ownerId: pageVersionTable.ownerId,
      lastSavedAt: pageVersionTable.lastSavedAt,
      contributorIds: pageVersionTable.contributorIds,
    })
    .from(pageVersionTable)
    .where(eq(pageVersionTable.pageId, page.id))
    .orderBy(desc(pageVersionTable.lastSavedAt), desc(pageVersionTable.id))
    .limit(1);

  const contributors = [
    ...new Set([...contributorIds, ...(actorId ? [actorId] : [])]),
  ];

  if (
    newest &&
    versionAction({ newest, userId: actorId, now, forceNew }) === "update"
  ) {
    await tx
      .update(pageVersionTable)
      .set({
        title: page.title,
        contentJson: json,
        contentMarkdown: markdown,
        lastSavedAt: now,
        contributorIds: [
          ...new Set([...newest.contributorIds, ...contributors]),
        ],
      })
      .where(eq(pageVersionTable.id, newest.id));
    return;
  }

  await tx.insert(pageVersionTable).values({
    pageId: page.id,
    workspaceId: page.workspaceId,
    ownerId: actorId,
    contributorIds: contributors,
    title: page.title,
    contentJson: json,
    contentMarkdown: markdown,
    lastSavedAt: now,
    createdAt: now,
  });
  await trimVersions(tx, page.id);
}
