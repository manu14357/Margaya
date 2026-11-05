// Answers readiness probes, whose default timeout is short: a pool that can't
// connect takes up to connectionTimeoutMillis (5s) to fail, so this gives up
// first and the probe gets a clear "not ready" instead of its own timeout.
const READINESS_TIMEOUT_MS = 3_000;

/** Whether `check` finishes in time. Failures go to the log, not the caller. */
export async function isDatabaseReady(
  check: () => Promise<unknown>,
  timeoutMs = READINESS_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer within ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([check(), timedOut]);
    return true;
  } catch (error) {
    // The query builder wraps the driver's error, which holds the actual reason.
    const reason = error instanceof Error ? (error.cause ?? error) : error;
    console.error(
      "Readiness check failed: the database can't be reached.",
      reason instanceof Error ? reason.message : reason,
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}
