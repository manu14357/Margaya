const BASE_DELAY = 1000;
const MAX_DELAY = 30_000;

/**
 * Wait before reconnect attempt `attempt` (0-based): 1 s doubling to 30 s.
 * Sockets never give up: an API restart or deploy can take minutes, and a
 * tab that stopped retrying shows stale data until it is reloaded.
 */
export function reconnectDelay(attempt: number): number {
  return Math.min(BASE_DELAY * 2 ** attempt, MAX_DELAY);
}

/**
 * Calls `wake` when the tab becomes visible again or the browser comes back
 * online, so a socket waiting out its backoff reconnects at once. Returns
 * the unsubscribe.
 */
export function onWake(wake: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === "visible") wake();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", wake);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", wake);
  };
}
