/** The API accepts at most this many task ids per membership call. */
export const CYCLE_TASK_BATCH_SIZE = 200;

export function chunkIds(
  ids: readonly string[],
  size = CYCLE_TASK_BATCH_SIZE,
): string[][] {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += size) {
    chunks.push(unique.slice(start, start + size));
  }
  return chunks;
}

/**
 * Selected task ids grouped by the cycle they are in now, for "No cycle"
 * (one remove call per cycle). Tasks without a cycle are left out.
 */
export function groupTaskIdsByCycle(
  taskIds: readonly string[],
  cycleOf: (taskId: string) => string | null | undefined,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const taskId of new Set(taskIds)) {
    const cycleId = cycleOf(taskId);
    if (!cycleId) continue;
    const group = groups.get(cycleId) ?? [];
    group.push(taskId);
    groups.set(cycleId, group);
  }
  return groups;
}

export type CycleTaskChangeSummary = {
  added: string[];
  moved: Array<{ taskId: string; fromCycleId: string }>;
  removed: string[];
  unchanged: string[];
  ignored: string[];
};

export function mergeTaskChanges(
  changes: readonly CycleTaskChangeSummary[],
): CycleTaskChangeSummary {
  return {
    added: changes.flatMap((change) => change.added),
    moved: changes.flatMap((change) => change.moved),
    removed: changes.flatMap((change) => change.removed),
    unchanged: changes.flatMap((change) => change.unchanged),
    ignored: changes.flatMap((change) => change.ignored),
  };
}

/** Task ids whose membership actually changed. */
export function changedTaskIds(change: CycleTaskChangeSummary): string[] {
  return [
    ...change.added,
    ...change.moved.map((move) => move.taskId),
    ...change.removed,
  ];
}
