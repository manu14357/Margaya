import { and, eq, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { pageTable, workspaceTable } from "../database/schema";
import { publishEvent } from "../events";
import { generateLinkToken } from "../publication/token";
import { loadVisiblePage, pageEventPayload } from "./controllers/shared";
import type { PageCaller } from "./rules";

// Publishing a page to a read-only public link. The workspace must allow
// public pages (an admin setting, off by default); only pages visible to the
// whole workspace can be published. Unpublishing revokes the token, and a
// later publish issues a new one. Making the page private, archiving it or
// turning the workspace setting off revokes it too.

export const PUBLICATION_MESSAGES = {
  disabled: "Public pages are turned off for this workspace",
  private: "Only pages visible to the whole workspace can be published",
  archived: "Restore the page before publishing it",
} as const;

export function publicPagePath(token: string): string {
  return `/public-page/${token}`;
}

async function workspaceAllowsPublicPages(workspaceId: string) {
  const [row] = await db
    .select({ allow: workspaceTable.allowPublicPages })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  return row?.allow === true;
}

function publicationOf(
  page: Pick<
    typeof pageTable.$inferSelect,
    "publicToken" | "publishedAt" | "access" | "archivedAt"
  >,
  allowed: boolean,
  canShare: boolean,
) {
  const token = allowed ? page.publicToken : null;
  return {
    published: token !== null,
    token,
    path: token ? publicPagePath(token) : null,
    publishedAt: token ? page.publishedAt : null,
    allowed,
    canPublish:
      allowed &&
      canShare &&
      page.access === "public" &&
      page.archivedAt === null,
    canUnpublish: canShare && token !== null,
  };
}

export async function getPagePublication(
  pageId: string,
  caller: PageCaller,
  canShare: boolean,
) {
  const page = await loadVisiblePage(db, pageId, caller);
  const allowed = await workspaceAllowsPublicPages(page.workspaceId);
  return publicationOf(page, allowed, canShare);
}

export async function publishPage(pageId: string, caller: PageCaller) {
  const page = await loadVisiblePage(db, pageId, caller);
  if (!(await workspaceAllowsPublicPages(page.workspaceId))) {
    throw new HTTPException(409, { message: PUBLICATION_MESSAGES.disabled });
  }
  if (page.access !== "public") {
    throw new HTTPException(409, { message: PUBLICATION_MESSAGES.private });
  }
  if (page.archivedAt !== null) {
    throw new HTTPException(409, { message: PUBLICATION_MESSAGES.archived });
  }
  if (page.publicToken) return publicationOf(page, true, true);

  const [published] = await db
    .update(pageTable)
    .set({
      publicToken: generateLinkToken(),
      publishedAt: new Date(),
      publishedById: caller.userId,
    })
    .where(and(eq(pageTable.id, page.id), eq(pageTable.access, "public")))
    .returning();
  if (!published) {
    throw new HTTPException(409, { message: PUBLICATION_MESSAGES.private });
  }
  await publishEvent("page.published", {
    ...pageEventPayload(published, caller.userId),
    title: published.title,
  });
  return publicationOf(published, true, true);
}

export async function unpublishPage(pageId: string, caller: PageCaller) {
  const page = await loadVisiblePage(db, pageId, caller);
  const allowed = await workspaceAllowsPublicPages(page.workspaceId);
  const [revoked] = await db
    .update(pageTable)
    .set({ publicToken: null, publishedAt: null, publishedById: null })
    .where(and(eq(pageTable.id, page.id), isNotNull(pageTable.publicToken)))
    .returning();
  if (!revoked) return publicationOf(page, allowed, true);
  await publishEvent("page.unpublished", {
    ...pageEventPayload(revoked, caller.userId),
    title: revoked.title,
  });
  return publicationOf(revoked, allowed, true);
}
