import {
  and,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../database";
import { projectTable, taskTable, userTable } from "../database/schema";
import { escapeLikePattern } from "../search/like-pattern";
import { DEFAULT_TRASH_PAGE_SIZE } from "./schema";
import { purgeAtFor, trashRetentionDays } from "./settings";

type Paging = { search?: string; page?: number; limit?: number };

function paging({ page, limit }: Paging) {
  const size = limit ?? DEFAULT_TRASH_PAGE_SIZE;
  const current = page ?? 1;
  return { page: current, limit: size, offset: (current - 1) * size };
}

/** Title contains the text, or the text is the task's number or key. */
function taskSearch(search: string | undefined, slug: string): SQL | undefined {
  const text = search?.trim();
  if (!text) return undefined;
  const conditions: SQL[] = [
    ilike(taskTable.title, `%${escapeLikePattern(text)}%`),
  ];
  const keyMatch = text.match(/^(?:([a-z0-9-]+)-)?#?(\d+)$/i);
  const number = keyMatch?.[2] ? Number.parseInt(keyMatch[2], 10) : Number.NaN;
  const prefix = keyMatch?.[1];
  if (
    Number.isSafeInteger(number) &&
    number <= 2_147_483_647 &&
    (!prefix || prefix.toLowerCase() === slug.toLowerCase())
  ) {
    conditions.push(eq(taskTable.number, number));
  }
  return or(...conditions);
}

const deleter = alias(userTable, "trash_deleter");
const batchMember = alias(taskTable, "trash_batch_member");

/**
 * A project's trash: the tasks deleted on their own (batch roots), newest
 * first, each with how many sub-tasks went with it.
 */
export async function listProjectTrash(
  project: { id: string; slug: string },
  query: Paging,
) {
  const { page, limit, offset } = paging(query);
  const days = trashRetentionDays();
  const where = and(
    eq(taskTable.projectId, project.id),
    isNotNull(taskTable.deletedAt),
    eq(taskTable.trashBatchId, taskTable.id),
    taskSearch(query.search, project.slug),
  );

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: taskTable.id,
        projectId: taskTable.projectId,
        number: taskTable.number,
        title: taskTable.title,
        status: taskTable.status,
        priority: taskTable.priority,
        deletedAt: taskTable.deletedAt,
        deletedById: deleter.id,
        deletedByName: deleter.name,
        subTaskCount: sql<number>`(
          select count(*)::int from ${taskTable} as ${sql.identifier("trash_batch_member")}
          where ${batchMember.trashBatchId} = ${taskTable.id}
            and ${batchMember.id} <> ${taskTable.id}
            and ${batchMember.deletedAt} is not null
        )`.mapWith(Number),
      })
      .from(taskTable)
      .leftJoin(deleter, eq(deleter.id, taskTable.deletedBy))
      .where(where)
      .orderBy(desc(taskTable.deletedAt), desc(taskTable.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(taskTable)
      .where(where),
  ]);

  const count = total?.value ?? 0;
  return {
    items: rows.map((row) => {
      const deletedAt = row.deletedAt ?? new Date(0);
      return {
        id: row.id,
        projectId: row.projectId,
        number: row.number,
        key: `${project.slug}-${row.number}`,
        title: row.title,
        status: row.status,
        priority: row.priority,
        subTaskCount: row.subTaskCount,
        deletedAt,
        deletedBy:
          row.deletedById && row.deletedByName !== null
            ? { id: row.deletedById, name: row.deletedByName }
            : null,
        purgeAt: purgeAtFor(deletedAt, days),
      };
    }),
    total: count,
    page,
    limit,
    hasMore: page * limit < count,
  };
}

/** A workspace's trashed projects, newest first, with their task counts. */
export async function listWorkspaceTrash(workspaceId: string, query: Paging) {
  const { page, limit, offset } = paging(query);
  const days = trashRetentionDays();
  const text = query.search?.trim();
  const where = and(
    eq(projectTable.workspaceId, workspaceId),
    isNotNull(projectTable.deletedAt),
    text ? ilike(projectTable.name, `%${escapeLikePattern(text)}%`) : undefined,
  );

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: projectTable.id,
        name: projectTable.name,
        slug: projectTable.slug,
        icon: projectTable.icon,
        deletedAt: projectTable.deletedAt,
        deletedById: deleter.id,
        deletedByName: deleter.name,
        taskCount: sql<number>`(
          select count(*)::int from ${taskTable} as ${sql.identifier("trash_batch_member")}
          where ${batchMember.projectId} = ${projectTable.id}
            and ${batchMember.trashBatchId} = ${projectTable.id}
        )`.mapWith(Number),
      })
      .from(projectTable)
      .leftJoin(deleter, eq(deleter.id, projectTable.deletedBy))
      .where(where)
      .orderBy(desc(projectTable.deletedAt), desc(projectTable.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(projectTable)
      .where(where),
  ]);

  const count = total?.value ?? 0;
  return {
    items: rows.map((row) => {
      const deletedAt = row.deletedAt ?? new Date(0);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        icon: row.icon,
        taskCount: row.taskCount,
        deletedAt,
        deletedBy:
          row.deletedById && row.deletedByName !== null
            ? { id: row.deletedById, name: row.deletedByName }
            : null,
        purgeAt: purgeAtFor(deletedAt, days),
      };
    }),
    total: count,
    page,
    limit,
    hasMore: page * limit < count,
  };
}

/** The live project a trash list belongs to, or null. */
export async function liveProjectOf(projectId: string, workspaceId: string) {
  const [project] = await db
    .select({ id: projectTable.id, slug: projectTable.slug })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  return project ?? null;
}
