type Placed = { id: string; position: number | null };

/**
 * The writes a drop needs for one column in its new order: tasks whose stored
 * position differs from their index, plus the moved task (its column changed).
 * Writing every task of the column turned one drag on a large board into
 * hundreds of requests, each followed by a full board refetch.
 */
export function placementWrites<T extends Placed>(
  tasks: readonly T[],
  movedTaskId?: string,
): { task: T; position: number }[] {
  const writes: { task: T; position: number }[] = [];
  tasks.forEach((task, position) => {
    if (task.id === movedTaskId || task.position !== position) {
      writes.push({ task, position });
    }
  });
  return writes;
}
