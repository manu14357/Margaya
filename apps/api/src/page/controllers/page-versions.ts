import { normalizeDocument } from "@margaya/editor-schema";
import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageVersionTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { applyServerChange } from "../content";
import { PAGE_MESSAGES, type PageCaller } from "../rules";
import { PAGE_LIMITS } from "../types";
import { getPageResponse, loadVisiblePage, pageEventPayload } from "./shared";
import { assertCanEdit } from "./update-page";

const versionSummaryColumns = {
  id: pageVersionTable.id,
  pageId: pageVersionTable.pageId,
  ownerId: pageVersionTable.ownerId,
  contributorIds: pageVersionTable.contributorIds,
  title: pageVersionTable.title,
  lastSavedAt: pageVersionTable.lastSavedAt,
  createdAt: pageVersionTable.createdAt,
};

/** The page's saved versions, newest first (at most 20). */
export async function listPageVersions(pageId: string, caller: PageCaller) {
  await loadVisiblePage(db, pageId, caller);
  return db
    .select(versionSummaryColumns)
    .from(pageVersionTable)
    .where(eq(pageVersionTable.pageId, pageId))
    .orderBy(desc(pageVersionTable.lastSavedAt), desc(pageVersionTable.id))
    .limit(PAGE_LIMITS.versionsPerPage);
}

async function loadVersion(pageId: string, versionId: string) {
  const [version] = await db
    .select()
    .from(pageVersionTable)
    .where(
      and(
        eq(pageVersionTable.id, versionId),
        eq(pageVersionTable.pageId, pageId),
      ),
    )
    .limit(1);
  if (!version) {
    throw new HTTPException(404, { message: PAGE_MESSAGES.versionNotFound });
  }
  return version;
}

/** One version with its content. */
export async function getPageVersion(
  pageId: string,
  versionId: string,
  caller: PageCaller,
) {
  await loadVisiblePage(db, pageId, caller);
  const version = await loadVersion(pageId, versionId);
  return {
    id: version.id,
    pageId: version.pageId,
    ownerId: version.ownerId,
    contributorIds: version.contributorIds,
    title: version.title,
    lastSavedAt: version.lastSavedAt,
    createdAt: version.createdAt,
    contentJson: version.contentJson,
    contentMarkdown: version.contentMarkdown,
  };
}

/**
 * Restores a version (K9): the current content is saved as a new version
 * first, then the content becomes the version's through the server change
 * helper, which reaches every connected editor like a normal edit.
 */
export async function restorePageVersion(
  pageId: string,
  versionId: string,
  caller: PageCaller,
) {
  const page = await loadVisiblePage(db, pageId, caller);
  assertCanEdit(page, caller);
  const version = await loadVersion(pageId, versionId);

  await applyServerChange({
    kind: "restore",
    pageId,
    versionId,
    actorId: caller.userId,
    target: normalizeDocument(version.contentJson),
  });
  await publishEvent("page.version_restored", {
    ...pageEventPayload(page, caller.userId),
    versionId,
    restoredBy: caller.userId,
  });
  return getPageResponse(pageId, caller);
}
