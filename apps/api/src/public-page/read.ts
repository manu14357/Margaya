import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  assetTable,
  pageTable,
  projectTable,
  workspaceTable,
} from "../database/schema";
import { currentPageDocument } from "../page/content";
import { publicBoardInstanceState } from "../public-board/instance-state";
import { isLinkTokenFormat } from "../publication/token";
import { getPrivateObject } from "../storage/s3";
import {
  imageAssetIds,
  linkedPageIds,
  sanitizePublicDocument,
} from "./sanitize";

// Reading a published page. Every condition that hides it answers the same
// 404, so a revoked link and a link that never existed look alike.

const NOT_FOUND = "Page not found";

const INLINE_IMAGE_TYPES = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function notFound(): HTTPException {
  return new HTTPException(404, { message: NOT_FOUND });
}

async function resolvePublishedPage(token: string) {
  if (!isLinkTokenFormat(token)) throw notFound();
  // The instance switch for public sharing covers pages as well as boards.
  if (!(await publicBoardInstanceState()).publicBoards) throw notFound();
  const [row] = await db
    .select({
      page: pageTable,
      allowPublicPages: workspaceTable.allowPublicPages,
      deletionDueAt: workspaceTable.deletionDueAt,
      projectDeletedAt: projectTable.deletedAt,
      projectArchivedAt: projectTable.archivedAt,
      pagesEnabled: projectTable.pagesEnabled,
    })
    .from(pageTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, pageTable.workspaceId))
    .innerJoin(projectTable, eq(projectTable.id, pageTable.projectId))
    .where(eq(pageTable.publicToken, token))
    .limit(1);
  if (
    !row?.allowPublicPages ||
    row.deletionDueAt !== null ||
    row.projectDeletedAt !== null ||
    row.projectArchivedAt !== null ||
    !row.pagesEnabled ||
    row.page.access !== "public" ||
    row.page.archivedAt !== null
  ) {
    throw notFound();
  }
  return row.page;
}

/** Image assets of the workspace among `ids`. */
async function workspaceImages(workspaceId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      id: assetTable.id,
      objectKey: assetTable.objectKey,
      mimeType: assetTable.mimeType,
    })
    .from(assetTable)
    .where(
      and(
        inArray(assetTable.id, ids),
        eq(assetTable.workspaceId, workspaceId),
        eq(assetTable.kind, "image"),
      ),
    );
}

export async function readPublicPage(token: string, apiBaseUrl: string) {
  const page = await resolvePublishedPage(token);
  const doc = await currentPageDocument(page);

  const linkedIds = linkedPageIds(doc);
  const linked =
    linkedIds.length > 0
      ? await db
          .select({
            id: pageTable.id,
            token: pageTable.publicToken,
            title: pageTable.title,
          })
          .from(pageTable)
          .where(
            and(
              inArray(pageTable.id, linkedIds),
              eq(pageTable.workspaceId, page.workspaceId),
              eq(pageTable.access, "public"),
              isNull(pageTable.archivedAt),
              isNotNull(pageTable.publicToken),
            ),
          )
      : [];
  const published = new Map(
    linked.map((row) => [row.id, { token: row.token ?? "", title: row.title }]),
  );
  const images = new Set(
    (await workspaceImages(page.workspaceId, imageAssetIds(doc))).map(
      (asset) => asset.id,
    ),
  );

  return {
    title: page.title,
    logoKind: page.logoKind,
    logoValue: page.logoValue,
    isFullWidth: page.isFullWidth,
    updatedAt: page.updatedAt.toISOString(),
    content: sanitizePublicDocument(doc, {
      assetUrl: (id) =>
        images.has(id)
          ? `${apiBaseUrl}/public-page/${encodeURIComponent(token)}/asset/${encodeURIComponent(id)}`
          : null,
      publishedPage: (id) => published.get(id) ?? null,
    }) as Record<string, unknown>,
  };
}

/** An image the published page shows; anything else is 404. */
export async function publicPageAsset(
  token: string,
  assetId: string,
): Promise<Response> {
  const page = await resolvePublishedPage(token);
  const doc = await currentPageDocument(page);
  if (!imageAssetIds(doc).includes(assetId)) throw notFound();
  const [asset] = await workspaceImages(page.workspaceId, [assetId]);
  if (!asset) throw notFound();

  try {
    const object = await getPrivateObject(asset.objectKey);
    const type =
      (object.contentType || asset.mimeType)
        .toLowerCase()
        .split(";")[0]
        ?.trim() ?? "";
    if (!INLINE_IMAGE_TYPES.has(type)) throw notFound();
    return new Response(object.body as BodyInit, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": "inline",
        "Content-Length": object.contentLength?.toString() || "",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw notFound();
  }
}
