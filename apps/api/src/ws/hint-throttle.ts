/**
 * At most one send per key per window: the first value goes out at once,
 * and the latest value pushed during the window goes out when it ends
 * (which opens the next window). Used for chatty refetch hints.
 */
export class HintThrottle<T> {
  private readonly windows = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; pending: T | null }
  >();

  constructor(
    private readonly windowMs: number,
    private readonly send: (value: T) => void,
  ) {}

  push(key: string, value: T) {
    const open = this.windows.get(key);
    if (open) {
      open.pending = value;
      return;
    }
    this.send(value);
    const timer = setTimeout(() => this.close(key), this.windowMs);
    timer.unref?.();
    this.windows.set(key, { timer, pending: null });
  }

  private close(key: string) {
    const window = this.windows.get(key);
    this.windows.delete(key);
    if (window?.pending) this.push(key, window.pending);
  }

  /** Drops every open window and pending value. */
  clear() {
    for (const { timer } of this.windows.values()) clearTimeout(timer);
    this.windows.clear();
  }
}
