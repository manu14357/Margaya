// Which project sockets are connected, so polling can back off while live
// messages keep a project current.
const liveSockets = new Map<string, number>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Marks one connected socket of a project. Returns the release. */
export function markProjectSocketLive(projectId: string): () => void {
  liveSockets.set(projectId, (liveSockets.get(projectId) ?? 0) + 1);
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (liveSockets.get(projectId) ?? 1) - 1;
    if (remaining > 0) liveSockets.set(projectId, remaining);
    else liveSockets.delete(projectId);
    notify();
  };
}

export function isProjectSocketLive(projectId: string): boolean {
  return liveSockets.has(projectId);
}

export function subscribeToProjectSockets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const MIN_REFRESH_DELAY_MS = 250;
const MAX_REFRESH_GAP_MS = 10_000;
/** Rest between refreshes, as a multiple of how long the last one took. */
const REFRESH_GAP_FACTOR = 4;
/** A refresh that never settles must not hold back later changes for good. */
const MAX_REFRESH_WAIT_MS = 30_000;

/**
 * Coalesces refreshes asked for by live messages. Reloading a 5,000-task board
 * takes about 50 requests, and invalidating restarts a reload already running,
 * so steady edits kept a board from ever finishing one.
 *
 * Only one refresh runs at a time. What arrives during it runs once afterwards,
 * and a slow board rests between refreshes, so it spends at most about a fifth
 * of its time reloading. A lone change after a quiet spell shows at once. A
 * hidden tab holds its refreshes until `wake`.
 */
export function createBatchedRefresh() {
  const pending = new Map<string, () => unknown>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waitGuard: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let disposed = false;
  let nextAllowedAt = 0;

  function arm() {
    if (disposed || running || timer !== null || pending.size === 0) return;
    timer = setTimeout(
      flush,
      Math.max(MIN_REFRESH_DELAY_MS, nextAllowedAt - Date.now()),
    );
  }

  async function flush() {
    timer = null;
    if (document.visibilityState === "hidden") return;
    const refreshes = [...pending.values()];
    pending.clear();
    running = true;
    const startedAt = Date.now();
    await Promise.race([
      Promise.allSettled(refreshes.map(async (refresh) => refresh())),
      new Promise((resolve) => {
        waitGuard = setTimeout(resolve, MAX_REFRESH_WAIT_MS);
      }),
    ]);
    if (waitGuard !== null) clearTimeout(waitGuard);
    waitGuard = null;
    running = false;
    const finishedAt = Date.now();
    nextAllowedAt =
      finishedAt +
      Math.min(
        (finishedAt - startedAt) * REFRESH_GAP_FACTOR,
        MAX_REFRESH_GAP_MS,
      );
    arm();
  }

  return {
    /** Asks for a refresh; one key runs once however often it is asked for. */
    schedule(key: string, refresh: () => unknown) {
      pending.set(key, refresh);
      arm();
    },
    /** The tab is visible again: runs what a hidden tab held back. */
    wake: arm,
    /**
     * Drops what is waiting: a closing project socket records that it closed,
     * and the catch-up when it opens again covers these changes.
     */
    dispose() {
      disposed = true;
      pending.clear();
      if (timer !== null) clearTimeout(timer);
      if (waitGuard !== null) clearTimeout(waitGuard);
      timer = null;
      waitGuard = null;
    },
  };
}
