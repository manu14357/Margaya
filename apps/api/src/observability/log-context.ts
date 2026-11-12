import { format } from "node:util";
import { currentRequestId } from "./request-context";

// The API logs through console.* in hundreds of places. Rather than rewrite
// them, the server wraps the console once at startup: a line written while a
// request is being handled names that request's ID, and
// MARGAYA_LOG_FORMAT=json turns every line into a JSON object.

type Level = "debug" | "info" | "log" | "warn" | "error";

const LEVELS: readonly Level[] = ["debug", "info", "log", "warn", "error"];

let installed = false;

export type LogFormat = "text" | "json";

export function logFormat(value = process.env.MARGAYA_LOG_FORMAT): LogFormat {
  return value?.trim().toLowerCase() === "json" ? "json" : "text";
}

export function formatLogLine(
  level: Level,
  args: unknown[],
  requestId: string | undefined,
  mode: LogFormat,
  now = new Date(),
): unknown[] {
  if (mode === "json") {
    return [
      JSON.stringify({
        time: now.toISOString(),
        level: level === "log" ? "info" : level,
        ...(requestId ? { requestId } : {}),
        msg: format(...args),
      }),
    ];
  }
  return requestId ? [`[req ${requestId}]`, ...args] : args;
}

/** Idempotent; call once when the server starts, never in tests. */
export function installLogContext(mode: LogFormat = logFormat()): void {
  if (installed) return;
  installed = true;
  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const requestId = currentRequestId();
      if (mode === "text" && !requestId) {
        original(...args);
        return;
      }
      original(...formatLogLine(level, args, requestId, mode));
    };
  }
}
