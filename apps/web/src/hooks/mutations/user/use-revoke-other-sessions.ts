import { useMutation, useQueryClient } from "@tanstack/react-query";
import { withPushKeptOnThisDevice } from "@/hooks/mutations/notification-preferences/use-push-subscription";
import { PUSH_STATUS_QUERY_KEY } from "@/hooks/queries/notification-preferences/use-get-push-status";
import { accountSecurityQueryKey } from "@/hooks/queries/user/use-account-security";
import { authClient } from "@/lib/auth-client";

/** Signs out every session except this one. */
function useRevokeOtherSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      withPushKeptOnThisDevice(async () => {
        const { error } = await authClient.revokeOtherSessions();
        if (error) {
          throw new Error(error.message || "Failed to sign out other sessions");
        }
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PUSH_STATUS_QUERY_KEY });
      return queryClient.invalidateQueries({
        queryKey: accountSecurityQueryKey,
      });
    },
  });
}

export default useRevokeOtherSessions;
