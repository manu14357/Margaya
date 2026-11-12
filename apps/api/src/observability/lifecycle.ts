import { getRedisPub, isRedisConfigured } from "../redis";

// Process lifecycle facts for the readiness probe and the health page.

const startedAt = new Date(Date.now() - process.uptime() * 1000);
let draining = false;

export function processStartedAt(): Date {
  return startedAt;
}

/** Shutdown began: readiness answers 503 so load balancers stop sending. */
export function markDraining(): void {
  draining = true;
}

export function isDraining(): boolean {
  return draining;
}

/** Test hook. */
export function resetDraining(): void {
  draining = false;
}

export type RedisState = "ok" | "unavailable" | "disabled";

/**
 * Pings the realtime Redis when one is configured. Redis only relays
 * realtime messages between instances, so the probe reports it without
 * failing on it: an outage there would otherwise take every replica out.
 */
export async function checkRedis(timeoutMs = 1_000): Promise<{
  state: RedisState;
  latencyMs: number | null;
}> {
  if (!isRedisConfigured()) return { state: "disabled", latencyMs: null };
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getRedisPub().ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return {
      state: "ok",
      latencyMs: Math.round(performance.now() - started),
    };
  } catch {
    return { state: "unavailable", latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}
