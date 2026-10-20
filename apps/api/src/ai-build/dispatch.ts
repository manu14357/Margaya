import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

// In-process calls to the API's own routes, as the calling person.
//
// "Talk to build" creates a reviewed proposal through the ordinary create
// routes rather than through a parallel write path: each item goes through
// the same authentication, workspace access, permission and feature checks,
// entitlement, validation, events, audit log and webhooks as if the web app
// had sent it. The request's credentials are forwarded; nothing else is.

type AppFetch = (
  request: Request,
  env?: unknown,
) => Response | Promise<Response>;

let appFetch: AppFetch | null = null;

/** Registered once by createApp() with the app's own fetch. */
export function setInternalApiFetch(fetch: AppFetch | null): void {
  appFetch = fetch;
}

// Credentials, the CSRF guard's origin headers, the realtime window (so the
// caller's own tab handles its events like any other write) and client hints
// for the audit log.
const FORWARDED_HEADERS = [
  "cookie",
  "authorization",
  "x-api-key",
  "origin",
  "referer",
  "sec-fetch-site",
  "x-margaya-window-id",
  "user-agent",
  "x-forwarded-for",
  "x-real-ip",
  "accept-language",
];

export type InternalResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

export type InternalApi = <T = unknown>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<InternalResult<T>>;

function errorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message.slice(0, 300);
  } catch {
    // Plain-text errors.
  }
  return text.slice(0, 300);
}

/** A caller of `/api/...` routes with this request's credentials. */
export function internalApi(c: Context): InternalApi {
  const fetch = appFetch;
  if (!fetch) {
    throw new HTTPException(500, { message: "Internal API is not ready" });
  }
  const origin = new URL(c.req.url).origin;
  const base = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = c.req.header(name);
    if (value) base.set(name, value);
  }
  base.set("accept", "application/json");

  return async (method, path, body) => {
    const headers = new Headers(base);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(
      new Request(`${origin}/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      c.env,
    );
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: errorMessage(text),
      };
    }
    try {
      return {
        ok: true,
        status: response.status,
        data: (text ? JSON.parse(text) : null) as never,
      };
    } catch {
      return { ok: false, status: 502, message: "Unreadable response" };
    }
  };
}
