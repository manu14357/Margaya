import { useMutation, useQueryClient } from "@tanstack/react-query";
import { publicBoardKeys } from "@/hooks/queries/public-board/public-board-keys";
import { authClient } from "@/lib/auth-client";
import { notifyDesktopSignedOut } from "@/lib/desktop";

/**
 * Continue as a guest in place (no navigation) and sign out from the
 * board. Either way the board refetches, since it carries the viewer.
 */
export function usePublicBoardSession(token: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    // The peek, its comments and my requests belong to the previous viewer
    // ("You", Edit, my vote): reset them rather than show them stale.
    for (const key of [
      ["public-board", token, "task"],
      ["public-board", token, "comments"],
      publicBoardKeys.myRequests(token),
    ]) {
      void queryClient.resetQueries({ queryKey: key });
    }
    return queryClient.invalidateQueries({
      queryKey: publicBoardKeys.all(token),
    });
  };

  const continueAsGuest = useMutation({
    mutationFn: async (turnstileToken: string | null) => {
      const result = await authClient.signIn.anonymous(
        {},
        {
          headers: turnstileToken
            ? { "x-turnstile-token": turnstileToken }
            : undefined,
        },
      );
      if (result.error) {
        throw new Error(result.error.message ?? "");
      }
    },
    onSuccess: () => void refresh(),
    meta: { refreshTaskQueries: false },
  });

  const signOut = useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message ?? "");
      // Same session as the app's: the desktop app signs out too.
      notifyDesktopSignedOut();
    },
    onSuccess: () => void refresh(),
    meta: { refreshTaskQueries: false },
  });

  return { continueAsGuest, signOut };
}
