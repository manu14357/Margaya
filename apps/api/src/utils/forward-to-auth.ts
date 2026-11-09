import { auth } from "../auth";
import { handleScimRequest } from "../identity/scim-http";
import { verifyApiKey } from "./verify-api-key";

/**
 * Scoped API keys (read-only, chosen areas or projects) are for the REST
 * API. Better Auth would turn them into a full session of their owner, so
 * they are refused on its routes (account, workspace and key management).
 */
async function refuseScopedKey(key: string): Promise<Response | null> {
  const verified = await verifyApiKey(key);
  if (!verified?.key.scoped) return null;
  return new Response("This API key is limited to the REST API", {
    status: 403,
    headers: { "content-type": "text/plain; charset=UTF-8" },
  });
}

/**
 * A SCIM DELETE has no body, but identity providers may send their content type
 * on every call. Better Auth parses whatever a JSON content type announces, so
 * the empty stream would answer 400 and the person would never be removed.
 */
function withoutScimDeleteBody(request: Request): Request {
  if (request.method !== "DELETE") return request;
  return new Request(request.url, {
    method: "DELETE",
    headers: request.headers,
  });
}

/**
 * Hands a request to Better Auth. A Bearer token that is not a session is
 * treated as an API key: it moves to x-api-key, the header the API key plugin
 * reads, and the Authorization header is dropped. Left in place, the bearer
 * plugin would read the key as a session token, and get-session would answer
 * null for it.
 */
export async function forwardToAuth(request: Request): Promise<Response> {
  // Identity providers send their own bearer token, which is neither a session
  // nor an API key; the SCIM plugin checks it.
  if (new URL(request.url).pathname.startsWith("/api/auth/scim/v2/")) {
    return handleScimRequest(withoutScimDeleteBody(request), (scimRequest) =>
      auth.handler(scimRequest),
    );
  }

  const apiKeyHeader = request.headers.get("x-api-key")?.trim();
  if (apiKeyHeader) {
    const refused = await refuseScopedKey(apiKeyHeader);
    if (refused) return refused;
  }

  const bearerToken = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearerToken || apiKeyHeader) {
    return auth.handler(request);
  }

  // Preserve Better Auth bearer session tokens on auth routes.
  const session = await auth.api.getSession({ headers: request.headers });
  if (session?.session && session.user) {
    return auth.handler(request);
  }

  const refused = await refuseScopedKey(bearerToken);
  if (refused) return refused;

  const headers = new Headers(request.headers);
  headers.set("x-api-key", bearerToken);
  headers.delete("authorization");
  return auth.handler(new Request(request, { headers }));
}
