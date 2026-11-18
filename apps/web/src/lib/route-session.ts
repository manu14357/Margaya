import { authClient } from "./auth-client";
import { isSigningOut } from "./sign-out";

type Session = typeof authClient.$Infer.Session;

type SessionState = {
  data: Session | null;
  error: unknown;
  isPending: boolean;
};

/**
 * The signed-in session the auth store already holds (AuthProvider's
 * `useSession` fetched it before the router first rendered), or null when it
 * holds none yet. The store refetches on sign-in, sign-out, workspace switches
 * and window focus, and a 401 reloads the page through handleUnauthorized, so
 * a held session is current enough to route by; the API still checks every
 * request. Reads `value`, never `get()`, which would mount and fetch.
 */
export function heldSession(): Session | null {
  if (isSigningOut()) return null;
  const atom = (authClient.$store.atoms as Record<string, unknown>).session as
    | { value?: SessionState }
    | undefined;
  const state = atom?.value;
  if (!state || state.isPending || state.error || !state.data) return null;
  const { session, user } = state.data;
  if (!session || !user) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return state.data;
}

/**
 * The session for a route's `beforeLoad`: the held one when there is one, so
 * navigations and hover preloads don't each ask the server again; otherwise
 * one request (signed out, just signed in, or the store not loaded yet).
 * Rejects only when the request itself fails.
 */
export async function routeSession(): Promise<Session | null> {
  const held = heldSession();
  if (held) return held;
  const { data } = await authClient.getSession();
  return data ?? null;
}
