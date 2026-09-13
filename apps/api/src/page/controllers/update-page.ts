import { markdownToJson } from "@margaya/editor-schema";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { applyServerChange } from "../content";
import {
  editableStateError,
  isPageOwner,
  PAGE_MESSAGES,
  type PageCaller,
  type PageState,
} from "../rules";
import type { UpdatePageInput } from "../schema";
import { readLogo } from "./logo";
import { getPageResponse, loadVisiblePage, pageEventPayload } from "./shared";

/** 409 when locked or archived; 403 for someone else's (ownerless) private page. */
export function assertCanEdit(page: PageState, caller: PageCaller) {
  const stateError = editableStateError(page);
  if (stateError) throw new HTTPException(409, { message: stateError });
  if (
    !caller.canUpdate ||
    (page.access !== "public" && !isPageOwner(page, caller))
  ) {
    throw new HTTPException(403, { message: PAGE_MESSAGES.cannotEdit });
  }
}

/** Changes the title, logo or width. Unchanged values publish nothing. */
export async function updatePage({
  pageId,
  input,
  caller,
}: {
  pageId: string;
  input: UpdatePageInput;
  caller: PageCaller;
}) {
  const logo = readLogo(input);

  const result = await db.transaction(async (tx) => {
    const page = await loadVisiblePage(tx, pageId, caller, { forUpdate: true });
    assertCanEdit(page, caller);

    const changes: Partial<typeof pageTable.$inferInsert> = {};
    const changed: string[] = [];
    if (input.title !== undefined && input.title !== page.title) {
      changes.title = input.title;
      changed.push("title");
    }
    if (
      logo &&
      (logo.logoKind !== page.logoKind || logo.logoValue !== page.logoValue)
    ) {
      Object.assign(changes, logo);
      changed.push("logo");
    }
    if (
      input.isFullWidth !== undefined &&
      input.isFullWidth !== page.isFullWidth
    ) {
      changes.isFullWidth = input.isFullWidth;
      changed.push("isFullWidth");
    }
    if (changed.length === 0) return { page, changed };

    await tx
      .update(pageTable)
      .set({ ...changes, updatedAt: new Date(), updatedById: caller.userId })
      .where(eq(pageTable.id, page.id));
    return { page, changed };
  });

  if (result.changed.length > 0) {
    await publishEvent("page.updated", {
      ...pageEventPayload(result.page, caller.userId),
      changed: result.changed,
    });
  }
  return getPageResponse(pageId, caller);
}

/** Replaces the whole content with markdown (§3.6 #5), through the server change helper. */
export async function replacePageContent({
  pageId,
  markdown,
  caller,
}: {
  pageId: string;
  markdown: string;
  caller: PageCaller;
}) {
  const page = await loadVisiblePage(db, pageId, caller);
  assertCanEdit(page, caller);
  await applyServerChange({
    kind: "replace",
    pageId,
    actorId: caller.userId,
    target: markdownToJson(markdown),
  });
  return getPageResponse(pageId, caller);
}
