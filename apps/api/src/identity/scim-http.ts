// What RFC 7644 asks of a SCIM request before it reaches Better Auth's router,
// and of every error after it. Requests no plugin endpoint matches never reach
// the before and after hooks (scim-hooks.ts), so these are answered here: an
// unknown path, a method an endpoint doesn't have, a body that isn't JSON, and
// POST .search, which the plugin doesn't serve. Errors that Better Auth itself
// writes, such as its validation and rate limit answers, get a SCIM error body.

const SCIM_PREFIX = "/api/auth/scim/v2";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const SCIM_TYPE = "application/scim+json; charset=utf-8";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The methods each endpoint has. A search at the root searches Users, the only
// resource type there is.
function allowedMethods(path: string): string[] | null {
  if (path === "/.search" || path === "/Users/.search") return ["POST"];
  if (path === "/Users") return ["GET", "POST"];
  if (/^\/Users\/[^/]+$/.test(path)) return ["GET", "PUT", "PATCH", "DELETE"];
  if (/^\/(ServiceProviderConfig|Schemas|ResourceTypes)$/.test(path)) {
    return ["GET"];
  }
  if (/^\/(Schemas|ResourceTypes)\/[^/]+$/.test(path)) return ["GET"];
  return null;
}

function scimErrorResponse(
  status: number,
  detail: string,
  scimType?: string,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", SCIM_TYPE);
  return new Response(
    JSON.stringify({
      schemas: [ERROR_SCHEMA],
      status: String(status),
      detail,
      ...(scimType ? { scimType } : {}),
    }),
    { status, headers: responseHeaders },
  );
}

const UNSUPPORTED_TYPE = "Send the body as application/scim+json";

const DETAILS: Record<number, string> = {
  400: "The request isn't valid",
  401: "A valid SCIM bearer token is required",
  404: "Not found",
  413: "The request is too large",
  415: UNSUPPORTED_TYPE,
  429: "Too many requests. Try again later.",
};

/** An error Better Auth wrote, with the body RFC 7644 (3.12) defines instead. */
async function withScimErrorBody(response: Response): Promise<Response> {
  if (response.status < 400) return response;
  const text = await response.clone().text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (
    isObject(body) &&
    Array.isArray(body.schemas) &&
    body.schemas.includes(ERROR_SCHEMA)
  ) {
    return response;
  }
  // Better Auth's own messages say what was wrong with the request. A server
  // error's could say more than a token holder should learn.
  const message =
    response.status < 500 && isObject(body) && typeof body.message === "string"
      ? body.message
      : null;
  const detail =
    message ||
    DETAILS[response.status] ||
    (response.status >= 500 ? "Something went wrong" : "The request failed");
  const scimType =
    response.status === 400 &&
    isObject(body) &&
    body.code === "VALIDATION_ERROR"
      ? "invalidValue"
      : undefined;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return scimErrorResponse(response.status, detail, scimType, headers);
}

const SEARCH_LISTS = ["attributes", "excludedAttributes"] as const;

/**
 * A POST .search as the GET of /Users it stands for (RFC 7644, 3.4.3), or the
 * error it gets. The plugin pages nothing, so startIndex and count pass along
 * as they would on a GET, and sorting, which it doesn't offer, is ignored.
 */
function searchAsList(request: Request, body: unknown): Request | Response {
  const query = new URLSearchParams();
  if (body !== undefined) {
    if (!isObject(body)) {
      return scimErrorResponse(
        400,
        "A search is a JSON object",
        "invalidSyntax",
      );
    }
    if (body.filter !== undefined) {
      if (typeof body.filter !== "string") {
        return scimErrorResponse(
          400,
          "filter must be a string",
          "invalidValue",
        );
      }
      query.set("filter", body.filter);
    }
    for (const key of SEARCH_LISTS) {
      const value = body[key];
      if (value === undefined) continue;
      const list = typeof value === "string" ? [value] : value;
      if (
        !Array.isArray(list) ||
        !list.every((item) => typeof item === "string")
      ) {
        return scimErrorResponse(
          400,
          `${key} must be a list of attribute names`,
          "invalidValue",
        );
      }
      query.set(key, list.join(","));
    }
    for (const key of ["startIndex", "count"] as const) {
      const value = body[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return scimErrorResponse(
          400,
          `${key} must be a whole number`,
          "invalidValue",
        );
      }
      query.set(key, String(value));
    }
  }
  const url = new URL(request.url);
  url.pathname = `${SCIM_PREFIX}/Users`;
  url.search = query.toString();
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return new Request(url, { method: "GET", headers });
}

// The JSON types Better Auth parses (better-call's getBody). Anything else it
// answers with 415, which withScimErrorBody turns into a SCIM error.
const JSON_TYPE = /^application\/([a-z0-9.+-]*\+)?json/i;

/**
 * The request with its body read, or the 400 invalidSyntax a body that isn't
 * JSON gets: Better Auth would answer it with an error of its own.
 */
async function withParsedBody(
  request: Request,
): Promise<{ request: Request; body: unknown } | Response> {
  const type = request.headers.get("content-type") ?? "";
  if (!request.body || (type && !JSON_TYPE.test(type))) {
    return { request, body: undefined };
  }
  const text = await request.text();
  let body: unknown;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return scimErrorResponse(
        400,
        "The request body isn't valid JSON",
        "invalidSyntax",
      );
    }
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return {
    request: new Request(request.url, {
      method: request.method,
      headers,
      // An empty body as no body: the plugin's validation then says what's missing.
      body: text.trim() ? text : undefined,
    }),
    body,
  };
}

/** Hands a request under /api/auth/scim/v2/ to Better Auth, as RFC 7644 asks. */
export async function handleScimRequest(
  request: Request,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  const path = new URL(request.url).pathname.slice(SCIM_PREFIX.length);
  const methods = allowedMethods(path);
  if (!methods) return scimErrorResponse(404, "There is no such endpoint");
  if (!methods.includes(request.method)) {
    return scimErrorResponse(
      405,
      `${request.method} isn't supported here`,
      undefined,
      { allow: methods.join(", ") },
    );
  }
  if (request.method === "GET" || request.method === "DELETE") {
    return withScimErrorBody(await handle(request));
  }

  const search = path.endsWith("/.search");
  const type = request.headers.get("content-type");
  if (search && type && !JSON_TYPE.test(type)) {
    return scimErrorResponse(415, UNSUPPORTED_TYPE);
  }
  const parsed = await withParsedBody(request);
  if (parsed instanceof Response) return parsed;
  const forwarded = search
    ? searchAsList(parsed.request, parsed.body)
    : parsed.request;
  if (forwarded instanceof Response) return forwarded;
  return withScimErrorBody(await handle(forwarded));
}
