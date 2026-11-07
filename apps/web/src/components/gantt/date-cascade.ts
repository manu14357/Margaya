import { addDays, differenceInCalendarDays } from "date-fns";
import {
  type BarSpan,
  type DependencyRelation,
  dependencyOverrunDays,
} from "./dependency-lines";

/** A task the plan may read; `locked` tasks are read but never moved. */
export type CascadeTask = { span: BarSpan; locked?: boolean };

export type CascadeMove = {
  taskId: string;
  /** Whole days later. */
  days: number;
  span: BarSpan;
};

// Relations can't loop within one type, but they can across types, and a loop
// would push its tasks later forever. Past this many steps there is no plan.
const MAX_STEPS = 20_000;

/**
 * The moves that make `rootId`'s dependents fit its dates again: each one
 * later by just enough, keeping its length, and each move's own dependents
 * after it. Nothing is ever moved earlier, and the root never moves.
 *
 * Only a plan: nothing changes until someone confirms it. Empty when nothing
 * needs to move, or when the relations loop.
 */
export function planDateCascade(
  rootId: string,
  relations: readonly DependencyRelation[],
  tasks: ReadonlyMap<string, CascadeTask>,
): CascadeMove[] {
  const outgoing = new Map<string, DependencyRelation[]>();
  for (const relation of relations) {
    const list = outgoing.get(relation.sourceTaskId);
    if (list) list.push(relation);
    else outgoing.set(relation.sourceTaskId, [relation]);
  }

  const moved = new Map<string, BarSpan>();
  const spanOf = (taskId: string) =>
    moved.get(taskId) ?? tasks.get(taskId)?.span;
  const queue = [rootId];
  let steps = 0;

  for (let head = 0; head < queue.length; head += 1) {
    const sourceId = queue[head] as string;
    const source = spanOf(sourceId);
    if (!source) continue;
    for (const relation of outgoing.get(sourceId) ?? []) {
      steps += 1;
      if (steps > MAX_STEPS) return [];
      const targetId = relation.targetTaskId;
      if (targetId === rootId || tasks.get(targetId)?.locked) continue;
      const target = spanOf(targetId);
      if (!target) continue;
      const days = dependencyOverrunDays(relation.relationType, source, target);
      if (days <= 0) continue;
      moved.set(targetId, {
        scheduleStart: addDays(target.scheduleStart, days),
        scheduleEnd: addDays(target.scheduleEnd, days),
      });
      queue.push(targetId);
    }
  }

  return [...moved].map(([taskId, span]) => ({
    taskId,
    span,
    days: differenceInCalendarDays(
      span.scheduleStart,
      (tasks.get(taskId) as CascadeTask).span.scheduleStart,
    ),
  }));
}
