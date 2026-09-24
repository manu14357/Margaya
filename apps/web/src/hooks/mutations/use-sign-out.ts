import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { getIdToken } from "@/fetchers/oauth/get-id-token";
import { authClient } from "@/lib/auth-client";
import { beginSignOut, endSignOut } from "@/lib/sign-out";

// Instance-wide data the sign-in page reads; it does not belong to the user.
const PUBLIC_QUERY_ROOTS = new Set(["config", "instance-status"]);

const IN_FLIGHT_WAIT_MS = 3000;

// Better Auth's own organization stores fetch outside TanStack Query.
const AUTH_STORE_NAMES = [
  "activeOrganization",
  "listOrganizations",
  "activeMember",
  "activeMemberRole",
];

/**
 * Reads `value`, never `get()`: nanostores' `get()` mounts a store that has
 * no listeners, and a mounted Better Auth store fetches. Polling with `get()`
 * started the very requests this waits for, and they raced the sign-out
 * into 401s.
 */
export function authStoresFetching() {
  const atoms = authClient.$store.atoms as Record<
    string,
    { value?: unknown } | undefined
  >;
  return AUTH_STORE_NAMES.some((name) => {
    const state = atoms[name]?.value as { isRefetching?: boolean } | undefined;
    return state?.isRefetching === true;
  });
}

function waitForIdle(isIdle: () => boolean) {
  return new Promise<void>((resolve) => {
    const deadline = Date.now() + IN_FLIGHT_WAIT_MS;
    const check = () => {
      if (isIdle() || Date.now() > deadline) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}

/**
 * Signs out without a reload or a burst of 401s: sockets close, the sign-in
 * page replaces the signed-in screens and in-flight requests settle before
 * the session ends; then the user's cached data is dropped.
 */
function useSignOut(idpLogoutUrl?: string | null) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      let idToken: string | null = null;

      if (idpLogoutUrl) {
        try {
          const data = await getIdToken();
          idToken = data.idToken;
        } catch {
          // If we can't get the id_token, proceed without it
        }
      }

      beginSignOut();
      try {
        // Unmount the signed-in screens while the session is still valid, so
        // nothing mounted refetches into a 401 once it ends, and let requests
        // already on the wire finish (most fetchers cannot be aborted).
        await navigate({ to: "/auth/sign-in", replace: true });
        await waitForIdle(
          () => queryClient.isFetching() === 0 && !authStoresFetching(),
        );

        // Without signals: Better Auth's organization stores outlive their
        // components by a moment (nanostores' unmount delay) and would
        // refetch on the sign-out signal, straight into 401s.
        const result = await authClient.signOut({
          fetchOptions: { disableSignal: true },
        });
        if (result.error) {
          await navigate({ to: "/dashboard", replace: true });
          throw new Error(result.error.message);
        }

        // Drop the signed-in data. The sign-in page's own queries are public
        // and stay, so it does not flash its skeleton.
        queryClient.removeQueries({
          predicate: (query) =>
            !PUBLIC_QUERY_ROOTS.has(String(query.queryKey[0])),
        });
        authClient.$store.notify("$sessionSignal");

        if (idpLogoutUrl) {
          const redirectUri = `${window.location.origin}/auth/sign-in`;
          const url = new URL(idpLogoutUrl);
          url.searchParams.set("post_logout_redirect_uri", redirectUri);
          if (idToken) {
            url.searchParams.set("id_token_hint", idToken);
          }
          window.location.href = url.toString();
        }
        return result.data;
      } finally {
        endSignOut();
      }
    },
  });
}

export default useSignOut;
