import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { quickLinkTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { normalizeLinkTitle, normalizeLinkUrl } from "../../utils/link-url";

type QuickLinkRow = typeof quickLinkTable.$inferSelect;

export const QUICK_LINK_NOT_FOUND = "Quick link not found";
export const DUPLICATE_QUICK_LINK = "This link is already in your quick links";
const INVALID_URL = "Enter a valid web address (http or https)";
const UNIQUE_CONSTRAINT = "quick_link_user_workspace_url_unique";

/** The normalized URL (the task link rules), or 400. */
export function requireQuickLinkUrl(raw: string): string {
  const result = normalizeLinkUrl(raw);
  if (!result.ok) throw new HTTPException(400, { message: INVALID_URL });
  return result.url;
}

/** Trimmed title; blank becomes null. Zod already bounds the length. */
export function quickLinkTitle(raw: string | null | undefined) {
  const result = normalizeLinkTitle(raw);
  if (!result.ok) throw new HTTPException(400, { message: result.message });
  return result.title;
}

export function ownQuickLinks(userId: string, workspaceId: string) {
  return and(
    eq(quickLinkTable.userId, userId),
    eq(quickLinkTable.workspaceId, workspaceId),
  );
}

export function toQuickLink(row: QuickLinkRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    url: row.url,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Runs a write, mapping a lost race on the URL index to the duplicate 409. */
export async function withDuplicateMapped<T>(write: () => Promise<T>) {
  try {
    return await write();
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "23505" &&
      "constraint" in cause &&
      cause.constraint === UNIQUE_CONSTRAINT
    ) {
      throw new HTTPException(409, { message: DUPLICATE_QUICK_LINK });
    }
    throw error;
  }
}

// Ids only: URLs and titles never travel through events.
export async function publishQuickLinkChanged(
  userId: string,
  workspaceId: string,
  quickLinkId: string,
  action: "created" | "updated" | "deleted",
) {
  await publishEvent("quick_link.changed", {
    userId,
    workspaceId,
    quickLinkId,
    action,
  });
}
