import { and, asc, count, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  type AiAssistInput,
  aiWriteProvenance,
  nextAiProvenance,
} from "../../ai/provenance";
import db from "../../database";
import {
  projectUpdateCommentTable,
  projectUpdateReactionTable,
  projectUpdateTable,
  userTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { groupReactions } from "../../reaction/emoji";
import { UPDATE_NOT_FOUND } from "../access";
import { computeProjectUpdateFacts } from "../facts";
import type { ProjectUpdateFacts, ProjectUpdateHealth } from "../types";

// Project updates: post, list, read, edit and delete. Authors edit and
// delete their own; project:update holders (admins by default) any.

export const DEFAULT_PAGE_SIZE = 20;

/** Who is asking, and whether they may manage everyone's updates. */
export type Caller = { userId: string; canManage: boolean };

type UpdateRow = typeof projectUpdateTable.$inferSelect & {
  authorName: string | null;
  authorImage: string | null;
};

const updateColumns = {
  id: projectUpdateTable.id,
  workspaceId: projectUpdateTable.workspaceId,
  projectId: projectUpdateTable.projectId,
  authorId: projectUpdateTable.authorId,
  health: projectUpdateTable.health,
  summary: projectUpdateTable.summary,
  highlights: projectUpdateTable.highlights,
  blockers: projectUpdateTable.blockers,
  nextSteps: projectUpdateTable.nextSteps,
  aiProvenance: projectUpdateTable.aiProvenance,
  facts: projectUpdateTable.facts,
  createdAt: projectUpdateTable.createdAt,
  updatedAt: projectUpdateTable.updatedAt,
  authorName: userTable.name,
  authorImage: userTable.image,
};

function selectUpdates(where: SQL) {
  return db
    .select(updateColumns)
    .from(projectUpdateTable)
    .leftJoin(userTable, eq(userTable.id, projectUpdateTable.authorId))
    .where(where);
}

// Cursors carry milliseconds; PostgreSQL keeps microseconds. Paging and its
// order both use the millisecond value so no row is skipped or repeated.
const createdAtMs = sql`date_trunc('milliseconds', ${projectUpdateTable.createdAt})`;

/** A page cursor: the last row's creation time and id. */
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString(
    "base64url",
  );
}

export function decodeCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, "base64url")
    .toString("utf8")
    .split("|");
  const createdAt = iso ? new Date(iso) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

async function decorate(rows: UpdateRow[], caller: Caller) {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const [counts, reactions] = await Promise.all([
    db
      .select({
        updateId: projectUpdateCommentTable.updateId,
        total: count(),
      })
      .from(projectUpdateCommentTable)
      .where(inArray(projectUpdateCommentTable.updateId, ids))
      .groupBy(projectUpdateCommentTable.updateId),
    db
      .select({
        updateId: projectUpdateReactionTable.updateId,
        emoji: projectUpdateReactionTable.emoji,
        userId: projectUpdateReactionTable.userId,
        name: userTable.name,
        image: userTable.image,
        createdAt: projectUpdateReactionTable.createdAt,
      })
      .from(projectUpdateReactionTable)
      .innerJoin(userTable, eq(userTable.id, projectUpdateReactionTable.userId))
      .where(inArray(projectUpdateReactionTable.updateId, ids))
      .orderBy(
        asc(projectUpdateReactionTable.createdAt),
        asc(projectUpdateReactionTable.id),
      ),
  ]);
  const commentCount = new Map(counts.map((row) => [row.updateId, row.total]));
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    author:
      row.authorId && row.authorName !== null
        ? {
            id: row.authorId,
            name: row.authorName,
            image: row.authorImage ?? null,
          }
        : null,
    health: row.health,
    summary: row.summary,
    highlights: row.highlights,
    blockers: row.blockers,
    nextSteps: row.nextSteps,
    aiProvenance: row.aiProvenance ?? null,
    facts: (row.facts as ProjectUpdateFacts | null) ?? null,
    commentCount: commentCount.get(row.id) ?? 0,
    reactions: groupReactions(
      reactions
        .filter((reaction) => reaction.updateId === row.id)
        .map((reaction) => ({ ...reaction, commentId: null })),
      caller.userId,
    ),
    canEdit: caller.canManage || row.authorId === caller.userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // A second's slack: the insert sets both stamps.
    editedAt:
      row.updatedAt.getTime() - row.createdAt.getTime() > 1000
        ? row.updatedAt
        : null,
  }));
}

export type ProjectUpdateView = Awaited<ReturnType<typeof decorate>>[number];

export async function listProjectUpdates(
  projectId: string,
  caller: Caller,
  page: { limit?: number; cursor?: string },
) {
  const limit = page.limit ?? DEFAULT_PAGE_SIZE;
  const after = page.cursor ? decodeCursor(page.cursor) : null;
  if (page.cursor && !after) {
    throw new HTTPException(400, { message: "cursor: Invalid cursor" });
  }
  const rows = await selectUpdates(
    and(
      eq(projectUpdateTable.projectId, projectId),
      after
        ? sql`(${createdAtMs}, ${projectUpdateTable.id}) < (${after.createdAt.toISOString()}::timestamptz, ${after.id})`
        : undefined,
    ) as SQL,
  )
    .orderBy(desc(createdAtMs), desc(projectUpdateTable.id))
    .limit(limit + 1);
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    updates: await decorate(pageRows, caller),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

async function loadUpdate(id: string) {
  const [row] = await selectUpdates(eq(projectUpdateTable.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: UPDATE_NOT_FOUND });
  return row;
}

export async function getProjectUpdateView(id: string, caller: Caller) {
  const [view] = await decorate([await loadUpdate(id)], caller);
  if (!view) throw new HTTPException(404, { message: UPDATE_NOT_FOUND });
  return view;
}

type UpdateInput = {
  health: ProjectUpdateHealth;
  summary: string;
  highlights?: string | null;
  blockers?: string | null;
  nextSteps?: string | null;
};

const textOrNull = (value: string | null | undefined) =>
  value?.trim() ? value.trim() : null;

export async function createProjectUpdate(
  input: UpdateInput & {
    projectId: string;
    workspaceId: string;
    aiAssist?: AiAssistInput;
  },
  caller: Caller,
) {
  // An agent's post (run key) or a person's accepted AI draft is labelled.
  const aiProvenance = await aiWriteProvenance({
    workspaceId: input.workspaceId,
    userId: caller.userId,
    assist: input.aiAssist,
  });
  // The facts behind the update, as of posting: readers can trace every
  // number back to tasks. Computed before the insert so "since" is the
  // previous update.
  const facts = await computeProjectUpdateFacts({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: caller.userId,
  });
  const [row] = await db
    .insert(projectUpdateTable)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      authorId: caller.userId,
      health: input.health,
      summary: input.summary.trim(),
      highlights: textOrNull(input.highlights),
      blockers: textOrNull(input.blockers),
      nextSteps: textOrNull(input.nextSteps),
      aiProvenance,
      facts,
    })
    .returning({ id: projectUpdateTable.id });
  if (!row) {
    throw new HTTPException(500, { message: "Couldn't post the update" });
  }
  await publishEvent("project_update.created", {
    updateId: row.id,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: caller.userId,
    health: input.health,
  });
  return getProjectUpdateView(row.id, caller);
}

function assertMayEdit(row: { authorId: string | null }, caller: Caller) {
  if (!caller.canManage && row.authorId !== caller.userId) {
    throw new HTTPException(403, {
      message: "Only the author or a project manager can change this update",
    });
  }
}

export async function editProjectUpdate(
  id: string,
  patch: Partial<UpdateInput>,
  caller: Caller,
) {
  const row = await loadUpdate(id);
  assertMayEdit(row, caller);
  const values: Partial<typeof projectUpdateTable.$inferInsert> = {};
  if (patch.health !== undefined) values.health = patch.health;
  if (patch.summary !== undefined) values.summary = patch.summary.trim();
  if (patch.highlights !== undefined) {
    values.highlights = textOrNull(patch.highlights);
  }
  if (patch.blockers !== undefined)
    values.blockers = textOrNull(patch.blockers);
  if (patch.nextSteps !== undefined) {
    values.nextSteps = textOrNull(patch.nextSteps);
  }
  if (Object.keys(values).length > 0) {
    // A person's edit keeps the AI label and names them; an agent's edit
    // labels it afresh.
    const provenance = await nextAiProvenance({
      existing: row.aiProvenance ?? null,
      changed: true,
      workspaceId: row.workspaceId,
      userId: caller.userId,
    });
    if (provenance !== undefined) values.aiProvenance = provenance;
    await db
      .update(projectUpdateTable)
      .set(values)
      .where(eq(projectUpdateTable.id, id));
    await publishEvent("project_update.updated", {
      updateId: id,
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      userId: caller.userId,
    });
  }
  return getProjectUpdateView(id, caller);
}

export async function deleteProjectUpdate(id: string, caller: Caller) {
  const row = await loadUpdate(id);
  assertMayEdit(row, caller);
  await db.delete(projectUpdateTable).where(eq(projectUpdateTable.id, id));
  await publishEvent("project_update.deleted", {
    updateId: id,
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    userId: caller.userId,
  });
  return { id, deleted: true as const };
}
