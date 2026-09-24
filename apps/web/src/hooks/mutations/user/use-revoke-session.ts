import { useMutation, useQueryClient } from "@tanstack/react-query";
import revokeSession from "@/fetchers/user/revoke-session";
import { accountSecurityQueryKey } from "@/hooks/queries/user/use-account-security";

/** Signs out one of the user's other sessions. */
function useRevokeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => revokeSession(sessionId),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: accountSecurityQueryKey }),
  });
}

export default useRevokeSession;
