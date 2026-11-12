import {
  applyJsonToYDoc,
  jsonToMarkdown,
  jsonToPlainText,
  markdownToJson,
  type PageDocument,
  yDocToJson,
  yjsStateToJson,
} from "@margaya/editor-schema";
import { eq, sql } from "drizzle-orm";
import * as Y from "yjs";
import { type AiProvenance, markHumanEdit } from "../ai/provenance";
import db from "../database";
import { pageTable, projectTable, userTable } from "../database/schema";
import { publishEvent } from "../events";
import type { PageRecord, Transaction } from "./controllers/shared";
import { syncPageReferences } from "./references";
import { PAGE_MESSAGES } from "./rules";
import { PAGE_LIMITS } from "./types";
import { insertForcedVersion, trackPageVersion } from "./versions";

// The content persistence procedure (spec §5.5): pull, merge, push under the
// page row lock. REST writes (content replace, version restore) run it with a
// temporary doc; collaboration rooms run it with their live doc.

/** Transaction origins on page docs. */
export const PAGE_DOC_ORIGIN = {
  /** State read from the database (load, the persist pull). */
  db: "db",
  /** A server-made change (restore, content replace). */
  server: "server",
} as const;

export class PageTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(PAGE_MESSAGES.tooLarge);
  }
}

export type PersistInput = {
  pageId: string;
  /** The doc to persist. The stored state is merged into it first. */
  doc: Y.Doc;
  /**
   * The contentVersion this doc last loaded or wrote. The stored state is
   * pulled into the doc when the row's version differs; null always pulls.
   */
  knownContentVersion: number | null;
  /** Runs first under the row lock; throw to abort (nothing is written). */
  guard?: (row: PageRecord) => void;
  /** Runs under the row lock after the pull (a server change). */
  mutate?: (doc: Y.Doc) => void;
  /** The latest contributor: versions and updatedById are attributed to them. */
  actorId: string | null;
  /** Everyone whose edits are in this persist. */
  contributorIds: string[];
  /**
   * A version restore: the current content is first saved as a new version,
   * and the restored content never coalesces into it.
   */
  restore?: boolean;
};

export type PersistOutcome =
  | {
      status: "saved";
      page: PageRecord;
      /** The markdown or the JSON changed. */
      changed: boolean;
      contentVersion: number;
      newlyMentionedUserIds: string[];
    }
  /** The row is gone (close rooms with 4404). */
  | { status: "gone" }
  /** Pages are off for the project (close rooms with 4404). */
  | { status: "feature-off" };

/**
 * Saves this soon after an AI label are part of the AI write: the accepted
 * text reaches the room (and its debounced persist) around the same time
 * the label is recorded.
 */
export const AI_LABEL_GRACE_MS = 15_000;

/**
 * The page's AI label after a person's content change: unchanged inside the
 * grace window, else naming them as the last editor. Undefined: no change.
 */
export async function pageProvenanceAfterEdit(
  reader: Transaction | typeof db,
  existing: AiProvenance | null,
  actorId: string | null,
  now: Date,
): Promise<AiProvenance | undefined> {
  if (!existing || !actorId) return undefined;
  const generatedAt = Date.parse(existing.generatedAt);
  if (
    Number.isFinite(generatedAt) &&
    now.getTime() - generatedAt < AI_LABEL_GRACE_MS
  ) {
    return undefined;
  }
  if (existing.editedById === actorId) {
    return markHumanEdit(
      existing,
      { id: actorId, name: existing.editedByName },
      now,
    );
  }
  const [person] = await reader
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, actorId))
    .limit(1);
  return markHumanEdit(
    existing,
    { id: actorId, name: person?.name ?? null },
    now,
  );
}

function isFragmentEmpty(doc: Y.Doc): boolean {
  return doc.getXmlFragment("default").length === 0;
}

/** The stored document of a row (markdown when no Yjs state exists yet). */
export function storedDocument(
  row: Pick<PageRecord, "contentYjs" | "contentMarkdown">,
): PageDocument {
  return row.contentYjs
    ? yjsStateToJson(row.contentYjs)
    : markdownToJson(row.contentMarkdown);
}

/** Merges the row's stored state into `doc` (origin `db`). */
export function pullStoredState(
  doc: Y.Doc,
  row: Pick<PageRecord, "contentYjs" | "contentMarkdown">,
) {
  if (row.contentYjs) {
    Y.applyUpdate(doc, row.contentYjs, PAGE_DOC_ORIGIN.db);
  } else if (isFragmentEmpty(doc)) {
    // A row written without the helpers: seed it from its markdown.
    applyJsonToYDoc(
      doc,
      markdownToJson(row.contentMarkdown),
      PAGE_DOC_ORIGIN.db,
    );
  }
}

async function lockPageRow(tx: Transaction, pageId: string) {
  const [row] = await tx
    .select()
    .from(pageTable)
    .where(eq(pageTable.id, pageId))
    .for("update");
  if (!row) return null;
  if (!row.projectId) return { row, pagesEnabled: true };
  const [project] = await tx
    .select({ pagesEnabled: projectTable.pagesEnabled })
    .from(projectTable)
    .where(eq(projectTable.id, row.projectId))
    .limit(1);
  return { row, pagesEnabled: project?.pagesEnabled ?? false };
}

/**
 * Persists a page doc: pulls the stored state into it, applies `mutate`,
 * writes the state and its projections (markdown, plain text), syncs the
 * references and versions, then publishes `page.content_updated` when the
 * content changed. Throws PageTooLargeError (nothing written) over 5 MiB.
 */
export async function persistPageDocument(
  input: PersistInput,
): Promise<PersistOutcome> {
  const { doc } = input;

  const outcome = await db.transaction(async (tx) => {
    const locked = await lockPageRow(tx, input.pageId);
    if (!locked) return { status: "gone" as const };
    if (!locked.pagesEnabled) return { status: "feature-off" as const };
    const { row } = locked;
    input.guard?.(row);

    const previousJson = storedDocument(row);
    if (
      input.knownContentVersion === null ||
      input.knownContentVersion !== row.contentVersion
    ) {
      pullStoredState(doc, row);
    }

    const now = new Date();
    if (input.restore) {
      // The current content first, so the restore itself can be undone.
      await insertForcedVersion(tx, {
        page: row,
        json: yDocToJson(doc),
        actorId: input.actorId,
        savedAt: new Date(now.getTime() - 1),
      });
    }

    input.mutate?.(doc);

    const state = Y.encodeStateAsUpdate(doc);
    if (state.byteLength > PAGE_LIMITS.yjsStateBytes) {
      throw new PageTooLargeError(state.byteLength);
    }

    const json = yDocToJson(doc);
    const markdown = jsonToMarkdown(json);
    const changed =
      markdown !== row.contentMarkdown ||
      JSON.stringify(json) !== JSON.stringify(previousJson);
    const aiProvenance = changed
      ? await pageProvenanceAfterEdit(tx, row.aiProvenance, input.actorId, now)
      : undefined;

    const [page] = await tx
      .update(pageTable)
      .set({
        contentYjs: Buffer.from(state),
        contentMarkdown: markdown,
        contentText: jsonToPlainText(json),
        contentVersion: sql`${pageTable.contentVersion} + 1`,
        ...(changed ? { updatedAt: now, updatedById: input.actorId } : {}),
        ...(aiProvenance ? { aiProvenance } : {}),
      })
      .where(eq(pageTable.id, row.id))
      .returning();
    if (!page) return { status: "gone" as const };

    const newlyMentionedUserIds = await syncPageReferences(tx, {
      page,
      json,
      actorId: input.actorId,
    });

    if (changed) {
      await trackPageVersion(tx, {
        page,
        json,
        markdown,
        actorId: input.actorId,
        contributorIds: input.contributorIds,
        forceNew: input.restore ?? false,
        now,
      });
    }

    return {
      status: "saved" as const,
      page,
      changed,
      contentVersion: page.contentVersion,
      newlyMentionedUserIds,
    };
  });

  if (outcome.status === "saved" && outcome.changed) {
    await publishEvent("page.content_updated", {
      pageId: outcome.page.id,
      projectId: outcome.page.projectId,
      workspaceId: outcome.page.workspaceId,
      userId: input.actorId,
      contentVersion: outcome.contentVersion,
      contributorIds: input.contributorIds,
      newlyMentionedUserIds: outcome.newlyMentionedUserIds,
    });
  }

  return outcome;
}
