// Dependency graph maths for the risk radar (A3). An edge `from → to` means
// `from` must finish before `to` can (task relations "blocks" and
// "finish_before"). The API refuses loops, but older data may hold some, so
// every walk here detects them instead of assuming a DAG.

export type Edge = { from: string; to: string };

function byId(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function adjacency(nodes: readonly string[], edges: readonly Edge[]) {
  const known = new Set(nodes);
  const next = new Map<string, string[]>();
  const prev = new Map<string, string[]>();
  for (const id of nodes) {
    next.set(id, []);
    prev.set(id, []);
  }
  const seen = new Set<string>();
  for (const { from, to } of edges) {
    if (!known.has(from) || !known.has(to) || from === to) continue;
    const key = `${from}\u0000${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.get(from)?.push(to);
    prev.get(to)?.push(from);
  }
  for (const list of next.values()) list.sort(byId);
  for (const list of prev.values()) list.sort(byId);
  return { next, prev };
}

/**
 * Kahn's algorithm with a deterministic tie-break (smallest id first).
 * Nodes on or behind a loop never reach in-degree zero: `loopNodeIds`.
 */
export function topoOrder(
  nodes: readonly string[],
  edges: readonly Edge[],
): { order: string[]; loopNodeIds: string[] } {
  const ids = [...new Set(nodes)].sort(byId);
  const { next, prev } = adjacency(ids, edges);
  const indegree = new Map(ids.map((id) => [id, prev.get(id)?.length ?? 0]));
  const ready = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(byId);
    const id = ready.shift() as string;
    order.push(id);
    for (const to of next.get(id) ?? []) {
      const left = (indegree.get(to) ?? 0) - 1;
      indegree.set(to, left);
      if (left === 0) ready.push(to);
    }
  }
  const placed = new Set(order);
  return { order, loopNodeIds: ids.filter((id) => !placed.has(id)) };
}

/**
 * The heaviest chain through the ordered nodes (loop nodes are left out):
 * each node's weight plus the heaviest chain of its predecessors. Ties go to
 * the smaller task id, so the answer is stable.
 */
export function longestPath(
  order: readonly string[],
  edges: readonly Edge[],
  weight: (id: string) => number,
): { taskIds: string[]; total: number } {
  if (order.length === 0) return { taskIds: [], total: 0 };
  const { prev } = adjacency(order, edges);
  const best = new Map<string, number>();
  const via = new Map<string, string | null>();
  for (const id of order) {
    let bestPrev: string | null = null;
    let bestPrevTotal = 0;
    for (const from of prev.get(id) ?? []) {
      const total = best.get(from);
      if (total === undefined) continue;
      if (bestPrev === null || total > bestPrevTotal) {
        bestPrev = from;
        bestPrevTotal = total;
      }
    }
    best.set(id, bestPrevTotal + weight(id));
    via.set(id, bestPrev);
  }
  let end = order[0] as string;
  for (const id of order) {
    const total = best.get(id) ?? 0;
    const current = best.get(end) ?? 0;
    if (total > current || (total === current && id < end)) end = id;
  }
  const taskIds: string[] = [];
  let cursor: string | null = end;
  while (cursor !== null) {
    taskIds.unshift(cursor);
    cursor = via.get(cursor) ?? null;
  }
  return { taskIds, total: best.get(end) ?? 0 };
}

export type BlockedChain = {
  /** An open blocker that nothing open blocks in turn. */
  headId: string;
  /** Tasks it holds up, directly or through others, nearest first. */
  blockedIds: string[];
  /** Longest number of hops from the head to a blocked task. */
  depth: number;
};

/**
 * For every root blocker, the tasks it holds up. `nodes` are open tasks
 * only; loops are skipped (they are reported separately).
 */
export function blockedChains(
  nodes: readonly string[],
  edges: readonly Edge[],
): BlockedChain[] {
  const ids = [...new Set(nodes)].sort(byId);
  const { next, prev } = adjacency(ids, edges);
  const chains: BlockedChain[] = [];
  for (const id of ids) {
    if ((prev.get(id)?.length ?? 0) > 0) continue;
    if ((next.get(id)?.length ?? 0) === 0) continue;
    const depthOf = new Map<string, number>();
    const queue: Array<[string, number]> = [[id, 0]];
    const visited = new Set([id]);
    while (queue.length > 0) {
      const [current, depth] = queue.shift() as [string, number];
      for (const to of next.get(current) ?? []) {
        // Longest hop count wins, but each node is expanded once (loops).
        depthOf.set(to, Math.max(depthOf.get(to) ?? 0, depth + 1));
        if (visited.has(to)) continue;
        visited.add(to);
        queue.push([to, depth + 1]);
      }
    }
    const blockedIds = [...depthOf.keys()].sort(
      (a, b) => (depthOf.get(a) ?? 0) - (depthOf.get(b) ?? 0) || byId(a, b),
    );
    chains.push({
      headId: id,
      blockedIds,
      depth: Math.max(0, ...depthOf.values()),
    });
  }
  return chains;
}
