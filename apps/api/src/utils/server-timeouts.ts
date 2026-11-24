import type { Server } from "node:http";

/**
 * How long an idle keep-alive connection stays open. Node's default (5 s) is
 * shorter than the idle timeout of most proxies and load balancers (often
 * 60 s) and close to what HTTP clients assume, so a client or proxy could
 * send a request on a connection the API was closing at that moment: the
 * request failed with ECONNRESET ("other side closed"). Under load the race
 * widens, because a busy event loop handles the expired idle timer before it
 * reads the request that arrived meanwhile. Outlasting the proxies' idle
 * timeout means they always close first.
 */
export const KEEP_ALIVE_TIMEOUT_MS = 65_000;

/** Longer than the keep-alive timeout, as Node's own guidance asks. */
export const HEADERS_TIMEOUT_MS = 66_000;

type TimeoutSettings = Pick<Server, "keepAliveTimeout" | "headersTimeout">;

/** Applies the timeouts to the API's HTTP/1.1 server (no-op otherwise). */
export function applyServerTimeouts(server: unknown) {
  if (!server || typeof server !== "object") return;
  if (!("keepAliveTimeout" in server) || !("headersTimeout" in server)) return;
  const http = server as TimeoutSettings;
  http.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  http.headersTimeout = HEADERS_TIMEOUT_MS;
}
