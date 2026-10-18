// Scope changes of a cycle (added, removed, carried over), as pure logic so
// the retro's counts and lists can't disagree: both come from these sets.

export type ScopeMember = { id: string; addedAt: Date };

export type ScopeChange = {
  taskId: string;
  at: Date;
  joined: boolean;
  left: boolean;
  toCycle: string | null;
};

export type ScopeSets = {
  added: Set<string>;
  removed: Set<string>;
  carried: Set<string>;
};

/**
 * Which tasks joined the cycle during its window (`start` inclusive, `end`
 * exclusive), which left it then, and which moved to another cycle after it
 * ended. Tasks still in the cycle are never removed or carried over.
 */
export function cycleScopeChanges(input: {
  members: readonly ScopeMember[];
  changes: readonly ScopeChange[];
  start: Date;
  end: Date;
}): ScopeSets {
  const { start, end } = input;
  const inWindow = (at: Date) => at >= start && at < end;
  const memberIds = new Set(input.members.map((member) => member.id));
  const added = new Set<string>();
  for (const member of input.members) {
    if (inWindow(member.addedAt)) added.add(member.id);
  }
  const removed = new Set<string>();
  const carried = new Set<string>();
  for (const change of input.changes) {
    if (change.joined && inWindow(change.at)) added.add(change.taskId);
    if (!change.left || memberIds.has(change.taskId)) continue;
    if (change.at >= end && change.toCycle) carried.add(change.taskId);
    else if (inWindow(change.at)) removed.add(change.taskId);
  }
  for (const id of carried) removed.delete(id);
  return { added, removed, carried };
}

/**
 * Keeps only tasks the reader can still see (deleted, archived or hidden
 * tasks drop out), so a fact's count always equals its list's total.
 */
export function visibleScope(
  sets: ScopeSets,
  isVisible: (id: string) => boolean,
): ScopeSets {
  const keep = (ids: Set<string>) =>
    new Set([...ids].filter((id) => isVisible(id)));
  return {
    added: keep(sets.added),
    removed: keep(sets.removed),
    carried: keep(sets.carried),
  };
}
