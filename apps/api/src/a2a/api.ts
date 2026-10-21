// In-process calls to the API's own routes with the A2A caller's credential.
// Everything an external agent asks for goes through the same routes the web
// app and the MCP server use: authentication, API key scopes and projects,
// workspace access, permissions, feature switches, events, webhooks and the
// audit log. The A2A layer adds no write path of its own.

type AppFetch = (
  request: Request,
  env?: unknown,
) => Response | Promise<Response>;

let appFetch: AppFetch | null = null;

/** Registered once by createApp() with the app's own fetch. */
export function setA2aApiFetch(fetch: AppFetch | null): void {
  appFetch = fetch;
}

export type A2aApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

export type A2aApi = <T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) => Promise<A2aApiResult<T>>;

function errorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown; code?: unknown };
    if (typeof parsed.message === "string") return parsed.message.slice(0, 300);
  } catch {
    // Plain-text errors.
  }
  return text.slice(0, 300);
}

export function a2aApi(
  token: string,
  client: { userAgent?: string; forwardedFor?: string; language?: string },
): A2aApi {
  return async (method, path, body) => {
    const fetch = appFetch;
    if (!fetch) return { ok: false, status: 500, message: "API not ready" };
    const headers = new Headers({
      authorization: `Bearer ${token}`,
      accept: "application/json",
      // The audit log shows the work came in over A2A, from which client.
      "user-agent": `Margaya A2A${
        client.userAgent ? ` (${client.userAgent.slice(0, 200)})` : ""
      }`,
    });
    if (client.forwardedFor)
      headers.set("x-forwarded-for", client.forwardedFor);
    if (client.language) headers.set("accept-language", client.language);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(
      new Request(`http://127.0.0.1/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
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
