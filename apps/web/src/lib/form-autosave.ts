type Values = Record<string, unknown>;

/** Shallow equality over the keys of `a`; `null` never matches. */
export function sameFormValues<T extends Values>(a: T, b: T | null): boolean {
  if (!b) return false;
  return Object.keys(a).every((key) => Object.is(a[key], b[key]));
}

/** How long a saved value waits for the server to echo it back. */
export const SAVE_ECHO_WINDOW_MS = 10_000;

/**
 * Autosaved settings forms re-sync from server snapshots. A snapshot requested
 * before a save can arrive after it and would put the old value back into the
 * form (and, on the next autosave, back on the server). After a save, only a
 * snapshot that matches the saved values is accepted, until the window ends.
 */
export function createSaveEchoGuard<T extends Values>(
  now: () => number = Date.now,
) {
  let expected: T | null = null;
  let expiresAt = 0;

  return {
    expect(values: T) {
      expected = values;
      expiresAt = now() + SAVE_ECHO_WINDOW_MS;
    },
    /** Whether a server snapshot is current enough to apply. */
    accepts(snapshot: T): boolean {
      if (!expected) return true;
      if (sameFormValues(expected, snapshot) || now() >= expiresAt) {
        expected = null;
        return true;
      }
      return false;
    },
  };
}
