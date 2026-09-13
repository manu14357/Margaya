import { COLLAB_LIMITS } from "./limits";

// When a room persists (spec §5.5): 2 s after the last change, at most 10 s
// after the first unsaved one, single flight (a change during a persist
// runs another one afterwards), and retries after failures at 5 s, 15 s,
// then every 60 s. `onSaveError` fires on the second consecutive failure.

export type PersistResult =
  /** Written. */
  | "saved"
  /** Failed; retry later. */
  | "failed"
  /** Nothing to do (clean, or the room closed). */
  | "idle";

export type PersistSchedulerOptions = {
  persist: () => Promise<PersistResult>;
  onSaveError: () => void;
  debounceMs?: number;
  maxWaitMs?: number;
  retryDelaysMs?: readonly number[];
};

type Timer = ReturnType<typeof setTimeout>;

function unrefTimer(timer: Timer): Timer {
  timer.unref?.();
  return timer;
}

export class PersistScheduler {
  private debounceTimer: Timer | null = null;
  private maxWaitTimer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private changedWhileRunning = false;
  private stopped = false;
  private failures = 0;

  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly retryDelaysMs: readonly number[];

  constructor(private readonly options: PersistSchedulerOptions) {
    this.debounceMs = options.debounceMs ?? COLLAB_LIMITS.persistDebounceMs;
    this.maxWaitMs = options.maxWaitMs ?? COLLAB_LIMITS.persistMaxWaitMs;
    this.retryDelaysMs = options.retryDelaysMs ?? COLLAB_LIMITS.persistRetryMs;
  }

  /** Consecutive failures so far. */
  get failureCount() {
    return this.failures;
  }

  /** Something changed: persist after the debounce (bounded by the max wait). */
  changed() {
    if (this.stopped) return;
    if (this.running) {
      // Scheduled once the running persist ends.
      this.changedWhileRunning = true;
      return;
    }
    // A pending retry already covers this change.
    if (this.retryTimer) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = unrefTimer(
      setTimeout(() => void this.now(), this.debounceMs),
    );
    this.maxWaitTimer ??= unrefTimer(
      setTimeout(() => void this.now(), this.maxWaitMs),
    );
  }

  /**
   * Persists now, or right after the running persist, and resolves once no
   * persist is running.
   */
  now(): Promise<void> {
    if (this.stopped) return this.running ?? Promise.resolve();
    this.clearTimers();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
      if (this.changedWhileRunning) {
        this.changedWhileRunning = false;
        this.changed();
      }
    });
    return this.running;
  }

  /** Cancels every timer; later calls do nothing. */
  stop() {
    this.stopped = true;
    this.clearTimers();
  }

  private async loop() {
    do {
      this.again = false;
      let result: PersistResult;
      try {
        result = await this.options.persist();
      } catch {
        result = "failed";
      }
      if (result === "failed") {
        this.failures++;
        if (this.failures === 2) this.options.onSaveError();
        this.armRetry();
        return;
      }
      if (result === "saved") this.failures = 0;
    } while (this.again && !this.stopped);
  }

  private armRetry() {
    if (this.stopped) return;
    const delays = this.retryDelaysMs;
    const delay =
      delays[Math.min(this.failures - 1, delays.length - 1)] ??
      COLLAB_LIMITS.persistRetryMs[0];
    this.retryTimer = unrefTimer(
      setTimeout(() => {
        this.retryTimer = null;
        void this.now();
      }, delay),
    );
  }

  private clearTimers() {
    for (const timer of [
      this.debounceTimer,
      this.maxWaitTimer,
      this.retryTimer,
    ]) {
      if (timer) clearTimeout(timer);
    }
    this.debounceTimer = null;
    this.maxWaitTimer = null;
    this.retryTimer = null;
  }
}
