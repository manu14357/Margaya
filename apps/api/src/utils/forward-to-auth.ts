import { auth } from "../auth";

/**
 * Hands a request to Better Auth. A Bearer token that is not a session is
 * treated as an API key: it moves to x-api-key, the header the API key plugin
 * reads, and the Authorization header is dropped. Left in place, the bearer
 * plugin would read the key as a session token, and get-session would answer
 * null for it.
 */
export async function forwardToAuth(request: Request): Promise<Response> {
  const bearerToken = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearerToken || request.headers.get("x-api-key")) {
    return auth.handler(request);
  }

  // Preserve Better Auth bearer session tokens on auth routes.
  const session = await auth.api.getSession({ headers: request.headers });
  if (session?.session && session.user) {
    return auth.handler(request);
  }

  const headers = new Headers(request.headers);
  headers.set("x-api-key", bearerToken);
  headers.delete("authorization");
  return auth.handler(new Request(request, { headers }));
}
