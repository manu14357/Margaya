import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { routeTemplateOf } from "../api-key/request-log";
import { httpDuration, httpRequests, methodLabel } from "./instruments";

// Request IDs: every response carries X-Request-Id, taken from the request
// when a proxy already set a safe one, otherwise generated. Code running for
// the request reads it through currentRequestId(), so log lines and error
// bodies can name it.

export const REQUEST_ID_HEADER = "X-Request-Id";

// Proxies send UUIDs, hex strings or their own tokens. Anything else (long,
// spaces, control characters) is replaced so it can't forge log lines.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:@-]{8,128}$/;

type RequestContext = { requestId: string };

const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function resolveRequestId(incoming: string | undefined): string {
  const value = incoming?.trim();
  return value && SAFE_REQUEST_ID.test(value) ? value : randomUUID();
}

function flag(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

/** Prometheus metrics are recorded only when the endpoint is on. */
export function metricsEnabled(): boolean {
  return flag("MARGAYA_METRICS_ENABLED");
}

/** One JSON line per request on stdout (MARGAYA_ACCESS_LOG=true). */
export function accessLogEnabled(): boolean {
  return flag("MARGAYA_ACCESS_LOG");
}

function setResponseHeader(c: Context, name: string, value: string): void {
  // A 101 upgrade is answered by the socket layer, not this response.
  if (c.res.status === 101) return;
  try {
    c.res.headers.set(name, value);
  } catch {
    // Responses passed through from fetch() have immutable headers.
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set(name, value);
  }
}

export type AccessLogEntry = {
  type: "access";
  time: string;
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
};

/**
 * The first middleware: assigns the request ID, and afterwards records the
 * request in the metrics and the access log. Paths and query strings are
 * never logged or labelled (they can hold tokens and ids); the route
 * template is.
 */
export function requestObservability(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): MiddlewareHandler {
  return async (c, next) => {
    const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER));
    const startedAt = performance.now();
    await requestContext.run({ requestId }, next);
    setResponseHeader(c, REQUEST_ID_HEADER, requestId);

    const recordMetrics = metricsEnabled();
    const logAccess = accessLogEnabled();
    if (!recordMetrics && !logAccess) return;

    const seconds = (performance.now() - startedAt) / 1000;
    const method = methodLabel(c.req.method);
    const route = routeTemplateOf(c);
    const status = c.res.status;
    if (recordMetrics) {
      httpRequests.inc({ method, route, status: String(status) });
      httpDuration.observe({ method, route }, seconds);
    }
    if (logAccess) {
      const entry: AccessLogEntry = {
        type: "access",
        time: new Date().toISOString(),
        requestId,
        method,
        route,
        status,
        durationMs: Math.round(seconds * 1000),
      };
      write(JSON.stringify(entry));
    }
  };
}
