/** Schedules one frame callback; `requestAnimationFrame` by default. */
export type FrameScheduler = {
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
};

/** Thrown into pending waits when the timeline is cancelled. */
export class DemoCancelled extends Error {
  constructor() {
    super("Demo cancelled");
    this.name = "DemoCancelled";
  }
}

export function isDemoCancelled(error: unknown): error is DemoCancelled {
  return error instanceof DemoCancelled;
}

/**
 * Play time for a script: it only advances while playing, so pausing (by
 * the button, an offscreen stage or a hidden tab) freezes every animation
 * mid-flight and resumes it exactly. Frames are requested only while
 * something is waiting, so an idle or paused stage costs nothing.
 */
export type Timeline = {
  /**
   * Resolves after `ms` of play time. `onFrame` receives the progress
   * (0 to 1) on every frame, ending with 1.
   */
  wait: (ms: number, onFrame?: (progress: number) => void) => Promise<void>;
  play: () => void;
  pause: () => void;
  /** Rejects every pending and future wait with `DemoCancelled`. */
  cancel: () => void;
  readonly playing: boolean;
  readonly cancelled: boolean;
  /** Play time so far, in ms. */
  readonly now: number;
};

/** The longest step one frame may take, so a stalled tab never jumps. */
const MAX_FRAME_MS = 64;

const rafScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
};

type Waiter = {
  start: number;
  duration: number;
  onFrame?: (progress: number) => void;
  resolve: () => void;
  reject: (error: unknown) => void;
};

export function createTimeline(
  scheduler: FrameScheduler = rafScheduler,
): Timeline {
  let playing = false;
  let cancelled = false;
  let now = 0;
  let lastFrame: number | null = null;
  let frameId: number | null = null;
  const waiters = new Set<Waiter>();

  const schedule = () => {
    if (frameId !== null || !playing || cancelled || waiters.size === 0) {
      return;
    }
    frameId = scheduler.request(onFrame);
  };

  const onFrame = (time: number) => {
    frameId = null;
    if (!playing || cancelled) return;
    if (lastFrame !== null) {
      now += Math.min(Math.max(time - lastFrame, 0), MAX_FRAME_MS);
    }
    lastFrame = time;
    for (const waiter of [...waiters]) {
      const elapsed = now - waiter.start;
      const progress =
        waiter.duration <= 0 ? 1 : Math.min(1, elapsed / waiter.duration);
      waiter.onFrame?.(progress);
      if (progress >= 1) {
        waiters.delete(waiter);
        waiter.resolve();
      }
    }
    schedule();
  };

  return {
    wait(ms, onFrame) {
      if (cancelled) return Promise.reject(new DemoCancelled());
      return new Promise<void>((resolve, reject) => {
        onFrame?.(0);
        waiters.add({ start: now, duration: ms, onFrame, resolve, reject });
        schedule();
      });
    },
    play() {
      if (playing || cancelled) return;
      playing = true;
      lastFrame = null;
      schedule();
    },
    pause() {
      playing = false;
      lastFrame = null;
      if (frameId !== null) {
        scheduler.cancel(frameId);
        frameId = null;
      }
    },
    cancel() {
      if (cancelled) return;
      this.pause();
      cancelled = true;
      const pending = [...waiters];
      waiters.clear();
      for (const waiter of pending) waiter.reject(new DemoCancelled());
    },
    get playing() {
      return playing;
    },
    get cancelled() {
      return cancelled;
    },
    get now() {
      return now;
    },
  };
}
