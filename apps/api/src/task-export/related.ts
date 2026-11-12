import { and, asc, eq, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type AiProvenance, commentAiProvenance } from "../ai/provenance";
import db from "../database";
import {
  activityTable,
  customFieldDefinitionTable,
  customFieldValueTable,
  cycleTable,
  externalLinkTable,
  labelTable,
  moduleTable,
  moduleTaskTable,
  projectTable,
  taskLinkTable,
  taskRelationTable,
  taskSubscriberTable,
  taskTable,
  timeEntryTable,
  userTable,
} from "../database/schema";
import { pointSnapshots } from "../estimate/assert-task-estimate";
import type { EstimateType } from "../estimate/types";
import { formatTaskKey } from "../task-activity/task-snapshot";
import { textArray } from "../task-query/context";
import { MAX_EXPORT_COMMENTS } from "./types";

// Batch loaders for one page of exported tasks: a fixed number of
// statements per page whatever its size, each id list one array parameter.

export type ExportUser = { id: string; name: string; email: string };
export type ExportComment = {
  id: string;
  /** The comment this one replies to, when it is a reply. */
  parentId: string | null;
  author: string | null;
  createdAt: Date;
  text: string;
  /** Set when AI wrote the comment (EU AI Act Article 50 marking). */
  aiProvenance?: AiProvenance | null;
};
export type ExportRelation = {
  type: string;
  task: string;
  direction: "outgoing" | "incoming";
};
export type ExportFieldValue = { name: string; type: string; value: string };

function group<K, V>(rows: Iterable<[K, V]>): Map<K, V[]> {
  const out = new Map<K, V[]>();
  for (const [key, value] of rows) {
    const list = out.get(key);
    if (list) list.push(value);
    else out.set(key, [value]);
  }
  return out;
}

/** Names and emails of these users (missing ids are left out). */
export async function loadUsers(
  ids: Iterable<string>,
): Promise<Map<string, ExportUser>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: userTable.id, name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(sql`${userTable.id} = any(${textArray(wanted)})`);
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * `WEB-12` style keys of these tasks, in any project of the workspace the
 * requester may see. A relation whose other task has no key here is left out.
 */
export async function loadTaskKeys(
  ids: Iterable<string>,
  workspaceId: string,
  hiddenProjectIds: readonly string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({
      id: taskTable.id,
      number: taskTable.number,
      slug: projectTable.slug,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    // A trashed task reads as gone (C7), so relations to it are left out.
    .where(
      and(
        sql`${taskTable.id} = any(${textArray(wanted)})`,
        eq(projectTable.workspaceId, workspaceId),
        hiddenProjectIds.length > 0
          ? sql`${projectTable.id} <> all(${textArray(hiddenProjectIds)})`
          : undefined,
        isNull(taskTable.deletedAt),
        isNull(projectTable.deletedAt),
      ),
    );
  return new Map(
    rows.map((row) => [row.id, formatTaskKey(row.slug, row.number)]),
  );
}

const workspaceLabel = alias(labelTable, "export_workspace_label");

/** Label copies of each task; the workspace label's color wins. */
export async function loadLabels(workspaceId: string, taskIds: string[]) {
  const rows = await db
    .select({
      taskId: labelTable.taskId,
      name: labelTable.name,
      color: sql<string>`coalesce(${workspaceLabel.color}, ${labelTable.color})`,
    })
    .from(labelTable)
    .leftJoin(
      workspaceLabel,
      and(
        eq(workspaceLabel.workspaceId, workspaceId),
        isNull(workspaceLabel.taskId),
        eq(workspaceLabel.name, labelTable.name),
      ),
    )
    .where(sql`${labelTable.taskId} = any(${textArray(taskIds)})`)
    .orderBy(asc(sql`lower(${labelTable.name})`), asc(labelTable.name));
  return group(
    rows.map((row) => [row.taskId ?? "", { name: row.name, color: row.color }]),
  );
}

/** Users who explicitly watch each task (muted rows are left out). */
export async function loadSubscriberIds(taskIds: string[]) {
  const rows = await db
    .select({
      taskId: taskSubscriberTable.taskId,
      userId: taskSubscriberTable.userId,
    })
    .from(taskSubscriberTable)
    .where(
      and(
        sql`${taskSubscriberTable.taskId} = any(${textArray(taskIds)})`,
        eq(taskSubscriberTable.subscribed, true),
      ),
    )
    .orderBy(
      asc(taskSubscriberTable.createdAt),
      asc(taskSubscriberTable.userId),
    );
  return group(rows.map((row) => [row.taskId, row.userId]));
}

export async function loadCycleNames(cycleIds: Iterable<string>) {
  const wanted = [...new Set(cycleIds)];
  if (wanted.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: cycleTable.id, name: cycleTable.name })
    .from(cycleTable)
    .where(sql`${cycleTable.id} = any(${textArray(wanted)})`);
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Active modules of each task's own project, by name. */
export async function loadModules(taskIds: string[]) {
  const rows = await db
    .select({
      taskId: moduleTaskTable.taskId,
      id: moduleTable.id,
      name: moduleTable.name,
    })
    .from(moduleTaskTable)
    .innerJoin(taskTable, eq(taskTable.id, moduleTaskTable.taskId))
    .innerJoin(
      moduleTable,
      and(
        eq(moduleTable.id, moduleTaskTable.moduleId),
        eq(moduleTable.projectId, taskTable.projectId),
        isNull(moduleTable.archivedAt),
      ),
    )
    .where(sql`${moduleTaskTable.taskId} = any(${textArray(taskIds)})`)
    .orderBy(asc(sql`lower(${moduleTable.name})`), asc(moduleTable.id));
  return group(rows.map((row) => [row.taskId, { id: row.id, name: row.name }]));
}

export async function loadEstimates(
  pointIds: Iterable<string>,
): Promise<Map<string, { value: string; type: EstimateType }>> {
  const snapshots = await pointSnapshots(db, [...new Set(pointIds)]);
  return new Map(
    [...snapshots].map(([id, point]) => [
      id,
      { value: point.value, type: point.type },
    ]),
  );
}

/** User links first, then integration links, each oldest first. */
export async function loadLinks(taskIds: string[]) {
  const ids = textArray(taskIds);
  const own = await db
    .select({
      taskId: taskLinkTable.taskId,
      title: taskLinkTable.title,
      url: taskLinkTable.url,
    })
    .from(taskLinkTable)
    .where(sql`${taskLinkTable.taskId} = any(${ids})`)
    .orderBy(asc(taskLinkTable.createdAt), asc(taskLinkTable.id));
  const external = await db
    .select({
      taskId: externalLinkTable.taskId,
      title: externalLinkTable.title,
      url: externalLinkTable.url,
    })
    .from(externalLinkTable)
    .where(sql`${externalLinkTable.taskId} = any(${ids})`)
    .orderBy(asc(externalLinkTable.createdAt), asc(externalLinkTable.id));
  return group(
    [...own, ...external].map((row) => [
      row.taskId,
      { title: row.title, url: row.url },
    ]),
  );
}

type StoredRelation = {
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
};

/** Non-parent relations touching these tasks, oldest first. */
export async function loadRelationRows(
  taskIds: string[],
): Promise<StoredRelation[]> {
  const ids = textArray(taskIds);
  return db
    .select({
      sourceTaskId: taskRelationTable.sourceTaskId,
      targetTaskId: taskRelationTable.targetTaskId,
      relationType: taskRelationTable.relationType,
    })
    .from(taskRelationTable)
    .where(
      and(
        sql`(${taskRelationTable.sourceTaskId} = any(${ids}) or ${taskRelationTable.targetTaskId} = any(${ids}))`,
        ne(taskRelationTable.relationType, "subtask"),
      ),
    )
    .orderBy(asc(taskRelationTable.createdAt), asc(taskRelationTable.id));
}

/** Each task's relations from its own side, with the other task's key. */
export function relationsByTask(
  taskIds: readonly string[],
  rows: readonly StoredRelation[],
  keys: ReadonlyMap<string, string>,
): Map<string, ExportRelation[]> {
  const wanted = new Set(taskIds);
  const out = new Map<string, ExportRelation[]>();
  const add = (taskId: string, relation: ExportRelation) => {
    const list = out.get(taskId) ?? [];
    list.push(relation);
    out.set(taskId, list);
  };
  for (const row of rows) {
    const targetKey = keys.get(row.targetTaskId);
    const sourceKey = keys.get(row.sourceTaskId);
    if (wanted.has(row.sourceTaskId) && targetKey) {
      add(row.sourceTaskId, {
        type: row.relationType,
        task: targetKey,
        direction: "outgoing",
      });
    }
    if (wanted.has(row.targetTaskId) && sourceKey) {
      add(row.targetTaskId, {
        type: row.relationType,
        task: sourceKey,
        direction: "incoming",
      });
    }
  }
  return out;
}

/**
 * The newest comments of each task (at most the cap; null for all of them),
 * newest first, plus which tasks have more. Imported comments keep their
 * external author.
 */
export async function loadComments(
  taskIds: string[],
  maxComments: number | null = MAX_EXPORT_COMMENTS,
) {
  const ranked = db
    .select({
      id: activityTable.id,
      parentId: activityTable.parentId,
      taskId: activityTable.taskId,
      content: activityTable.content,
      createdAt: activityTable.createdAt,
      authorName: userTable.name,
      externalName: activityTable.externalUserName,
      aiProvenance: activityTable.aiProvenance,
      eventData: activityTable.eventData,
      rank: sql<number>`row_number() over (partition by ${activityTable.taskId} order by ${activityTable.createdAt} desc, ${activityTable.id} desc)`
        .mapWith(Number)
        .as("rank"),
    })
    .from(activityTable)
    .leftJoin(userTable, eq(userTable.id, activityTable.userId))
    .where(
      and(
        sql`${activityTable.taskId} = any(${textArray(taskIds)})`,
        eq(activityTable.type, "comment"),
        isNotNull(activityTable.content),
      ),
    )
    .as("export_ranked_comment");
  const rows = await db
    .select()
    .from(ranked)
    .where(maxComments === null ? undefined : lte(ranked.rank, maxComments + 1))
    .orderBy(asc(ranked.taskId), asc(ranked.rank));

  const comments = new Map<string, ExportComment[]>();
  const truncated = new Set<string>();
  for (const row of rows) {
    if (maxComments !== null && row.rank > maxComments) {
      truncated.add(row.taskId);
      continue;
    }
    const list = comments.get(row.taskId) ?? [];
    list.push({
      id: row.id,
      parentId: row.parentId,
      author: row.authorName ?? row.externalName ?? null,
      createdAt: row.createdAt,
      text: row.content ?? "",
      aiProvenance: commentAiProvenance(row),
    });
    comments.set(row.taskId, list);
  }
  return { comments, truncated };
}

/** Logged time per task in whole minutes. */
export async function loadTimeLogged(
  taskIds: string[],
): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db
    .select({
      taskId: timeEntryTable.taskId,
      seconds:
        sql<number>`coalesce(sum(${timeEntryTable.duration}), 0)::bigint`.mapWith(
          Number,
        ),
    })
    .from(timeEntryTable)
    .where(sql`${timeEntryTable.taskId} = any(${textArray(taskIds)})`)
    .groupBy(timeEntryTable.taskId);
  return new Map(rows.map((row) => [row.taskId, Math.floor(row.seconds / 60)]));
}

/** Set custom-field values of each task, in field order. */
export async function loadFieldValues(taskIds: string[]) {
  const rows = await db
    .select({
      taskId: customFieldValueTable.taskId,
      name: customFieldDefinitionTable.name,
      type: customFieldDefinitionTable.type,
      value: sql<string>`${customFieldValueTable.value}`,
    })
    .from(customFieldValueTable)
    .innerJoin(taskTable, eq(taskTable.id, customFieldValueTable.taskId))
    .innerJoin(
      customFieldDefinitionTable,
      and(
        eq(customFieldDefinitionTable.id, customFieldValueTable.fieldId),
        eq(customFieldDefinitionTable.projectId, taskTable.projectId),
      ),
    )
    .where(
      and(
        sql`${customFieldValueTable.taskId} = any(${textArray(taskIds)})`,
        isNotNull(customFieldValueTable.value),
      ),
    )
    .orderBy(
      asc(customFieldDefinitionTable.position),
      asc(customFieldDefinitionTable.id),
    );
  return group<string, ExportFieldValue>(
    rows.map((row) => [
      row.taskId,
      { name: row.name, type: row.type, value: row.value },
    ]),
  );
}
