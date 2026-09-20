// Per-browser, per-workspace state of Home's "Get started" block. Storage can
// be unavailable (private mode, blocked site data): reads then return the
// defaults and writes are dropped.

export type GetStartedState = {
  hidden: boolean;
  visitedWorkspaceSettings: boolean;
  visitedAccount: boolean;
};

export const DEFAULT_GET_STARTED_STATE: GetStartedState = {
  hidden: false,
  visitedWorkspaceSettings: false,
  visitedAccount: false,
};

export function getStartedStorageKey(workspaceId: string) {
  return `margaya:home:get-started:${workspaceId}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readGetStartedState(
  workspaceId: string,
  storage: StorageLike | null = defaultStorage(),
): GetStartedState {
  try {
    const raw = storage?.getItem(getStartedStorageKey(workspaceId));
    if (!raw) return { ...DEFAULT_GET_STARTED_STATE };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_GET_STARTED_STATE };
    }
    const value = parsed as Record<string, unknown>;
    return {
      hidden: value.hidden === true,
      visitedWorkspaceSettings: value.visitedWorkspaceSettings === true,
      visitedAccount: value.visitedAccount === true,
    };
  } catch {
    return { ...DEFAULT_GET_STARTED_STATE };
  }
}

/** Merges the change into the stored state and returns the new state. */
export function writeGetStartedState(
  workspaceId: string,
  change: Partial<GetStartedState>,
  storage: StorageLike | null = defaultStorage(),
): GetStartedState {
  const next = { ...readGetStartedState(workspaceId, storage), ...change };
  try {
    storage?.setItem(getStartedStorageKey(workspaceId), JSON.stringify(next));
  } catch {
    // Ignored: the block still works for this page visit.
  }
  return next;
}
