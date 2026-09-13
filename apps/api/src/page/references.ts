import { type PageDocument, referencesFromJson } from "@margaya/editor-schema";
import { and, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import {
  pageReferenceTable,
  projectTable,
  taskTable,
} from "../database/schema";
import { escapeLikePattern } from "../search/like-pattern";
import { TASK_SHORT_ID_PATTERN } from "../search/task-short-id";
import { liveTaskCondition } from "../task/scope";
import type { PageRecord, Transaction } from "./controllers/shared";
import type { PageReferenceType } from "./types";

// page_reference rows (K16): the members, tasks and pages a page's content
// references. Kept in step with the content on every content write.

type Reference = { entityType: PageReferenceType; entityId: string };

function referenceKey(ref: Reference) {
  return `${ref.entityType}:${ref.entityId}`;
}

/** Task ids for key-only task links ("WEB-12"), inside the workspace; best effort. */
async function resolveTaskKeys(
  tx: Transaction,
  workspaceId: string,
  keys: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const key of keys.slice(0, 50)) {
    const match = key.normalize("NFKC").match(TASK_SHORT_ID_PATTERN);
    const number = Number(match?.[2]);
    if (
      !match?.[1] ||
      !Number.isSafeInteger(number) ||
      number > 2_147_483_647
    ) {
      continue;
    }
    const [task] = await tx
      .select({ id: taskTable.id })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          ilike(projectTable.slug, escapeLikePattern(match[1])),
          eq(taskTable.number, number),
          // A trashed task, or one in a trashed project, reads as gone (C7).
          liveTaskCondition,
          isNull(projectTable.deletedAt),
        ),
      )
      .limit(1);
    if (task) ids.push(task.id);
  }
  return ids;
}

/** The references a document makes (self-links ignored). */
export async function documentReferences(
  tx: Transaction,
  page: Pick<PageRecord, "id" | "workspaceId">,
  json: PageDocument,
): Promise<Reference[]> {
  const found = referencesFromJson(json, { selfPageId: page.id });
  const taskIds = [
    ...new Set([
      ...found.taskIds,
      ...(await resolveTaskKeys(tx, page.workspaceId, found.taskKeys)),
    ]),
  ];
  return [
    ...found.userIds.map((entityId) => ({
      entityType: "user" as const,
      entityId,
    })),
    ...taskIds.map((entityId) => ({ entityType: "task" as const, entityId })),
    ...found.pageIds.map((entityId) => ({
      entityType: "page" as const,
      entityId,
    })),
  ];
}

/**
 * Inserts new references and deletes missing ones. Returns the users
 * mentioned now but not before, without the actor.
 */
export async function syncPageReferences(
  tx: Transaction,
  {
    page,
    json,
    actorId,
  }: {
    page: Pick<PageRecord, "id" | "workspaceId">;
    json: PageDocument;
    actorId: string | null;
  },
): Promise<string[]> {
  const desired = await documentReferences(tx, page, json);
  const existing = await tx
    .select({
      entityType: pageReferenceTable.entityType,
      entityId: pageReferenceTable.entityId,
    })
    .from(pageReferenceTable)
    .where(eq(pageReferenceTable.pageId, page.id));

  const existingKeys = new Set(existing.map(referenceKey));
  const desiredKeys = new Set(desired.map(referenceKey));
  const added = desired.filter((ref) => !existingKeys.has(referenceKey(ref)));
  const removed = existing.filter((ref) => !desiredKeys.has(referenceKey(ref)));

  if (added.length > 0) {
    await tx
      .insert(pageReferenceTable)
      .values(
        added.map((ref) => ({
          pageId: page.id,
          workspaceId: page.workspaceId,
          ...ref,
        })),
      )
      .onConflictDoNothing();
  }
  if (removed.length > 0) {
    await tx
      .delete(pageReferenceTable)
      .where(
        and(
          eq(pageReferenceTable.pageId, page.id),
          or(
            ...removed.map(
              (ref) =>
                and(
                  eq(pageReferenceTable.entityType, ref.entityType),
                  eq(pageReferenceTable.entityId, ref.entityId),
                ) as SQL,
            ),
          ),
        ),
      );
  }

  return added
    .filter((ref) => ref.entityType === "user" && ref.entityId !== actorId)
    .map((ref) => ref.entityId);
}
