import { publishEvent } from "../events";
import {
  loadTaskSnapshots,
  type TaskSnapshot,
} from "../task-activity/task-snapshot";

/**
 * Why a relation row appeared or went away. Activity subscribers use it to
 * avoid double rows (a parent change writes one `parent_changed` of its own)
 * and to stay quiet when a deleted task takes its relations with it.
 */
export type RelationEventOrigin =
  | "user"
  | "parent_change"
  | "copy"
  | "task_deleted";

export type RelationRow = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
  createdAt: Date;
};

/**
 * Publishes `task-relation.created` or `.deleted`. The payload is the row
 * plus `taskId`/`projectId` of the stored source, `targetProjectId`, the
 * origin and key/title snapshots of both tasks. Missing snapshots are
 * loaded in one query.
 */
export async function publishRelationEvent(
  eventName: "task-relation.created" | "task-relation.deleted",
  {
    relation,
    userId,
    origin,
    snapshots,
  }: {
    relation: RelationRow;
    userId: string;
    origin: RelationEventOrigin;
    snapshots?: Map<string, TaskSnapshot>;
  },
) {
  let known = snapshots ?? new Map<string, TaskSnapshot>();
  if (!known.has(relation.sourceTaskId) || !known.has(relation.targetTaskId)) {
    known = new Map([
      ...known,
      ...(await loadTaskSnapshots([
        relation.sourceTaskId,
        relation.targetTaskId,
      ])),
    ]);
  }
  const source = known.get(relation.sourceTaskId);
  const target = known.get(relation.targetTaskId);
  if (!source) return;

  await publishEvent(eventName, {
    ...relation,
    taskId: relation.sourceTaskId,
    projectId: source.projectId,
    targetProjectId: target?.projectId ?? null,
    userId,
    origin,
    sourceTaskKey: source.key,
    sourceTaskTitle: source.title,
    targetTaskKey: target?.key ?? null,
    targetTaskTitle: target?.title ?? null,
  });
}
