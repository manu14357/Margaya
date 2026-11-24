// Code and translations load in chunks on demand. Under load a chunk request
// can fail although the chunk exists; one more try usually works. Without
// retries the router reloaded the whole page once on such a failure, and a
// failed translation chunk left raw keys on every button.

/** A chunk that still failed after its retries. */
export class ChunkLoadError extends Error {
  constructor(options?: { cause?: unknown }) {
    // Deliberately not a browser "dynamically imported module" message: the
    // router reloads the page, without a word, on those.
    super("A part of the app failed to load", options);
    this.name = "ChunkLoadError";
  }
}

/** Waits before each retry: three more tries over about five seconds. */
export const CHUNK_RETRY_DELAYS_MS = [500, 1_500, 3_000] as const;

// The browsers' messages for a module that could not be fetched, and Vite's
// for a stylesheet a chunk needs.
const LOAD_FAILURE_MESSAGES = [
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
  "Unable to preload CSS",
];

/** Whether an error says a chunk could not be fetched (not that it broke). */
export function isChunkLoadFailure(error: unknown): boolean {
  if (error instanceof ChunkLoadError) return true;
  const message = error instanceof Error ? error.message : "";
  return LOAD_FAILURE_MESSAGES.some((prefix) => message.startsWith(prefix));
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `load` (a dynamic import), trying again after each delay while the
 * chunk cannot be fetched. Errors from inside a loaded module are not
 * retried. A chunk that never loads ends in a ChunkLoadError.
 */
export async function retryChunk<T>(
  load: () => Promise<T>,
  delays: readonly number[] = CHUNK_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await load();
    } catch (error) {
      if (!isChunkLoadFailure(error)) throw error;
      const delay = delays[attempt];
      if (delay === undefined) throw new ChunkLoadError({ cause: error });
      await wait(delay);
    }
  }
}

// Translations fail silently (keys show instead of text), so a failure there
// asks for a reload through a prompt any screen shows (ChunkLoadPrompt).
let loadFailed = false;
const listeners = new Set<() => void>();

export function reportChunkLoadFailure() {
  if (loadFailed) return;
  loadFailed = true;
  for (const listener of listeners) listener();
}

export function hasChunkLoadFailed() {
  return loadFailed;
}

export function subscribeToChunkLoadFailure(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only. */
export function resetChunkLoadFailure() {
  loadFailed = false;
}
