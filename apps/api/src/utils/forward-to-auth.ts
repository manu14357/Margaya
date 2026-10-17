import { auth } from "../auth";
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
 * Hands a request to Better Auth. A Bearer token that is not a session is
 * treated as an API key: it moves to x-api-key, the header the API key plugin
 * reads, and the Authorization header is dropped. Left in place, the bearer
 * plugin would read the key as a session token, and get-session would answer
 * null for it.
 */
export async function forwardToAuth(request: Request): Promise<Response> {
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
