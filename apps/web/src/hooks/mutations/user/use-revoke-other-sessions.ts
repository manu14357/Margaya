import { useMutation, useQueryClient } from "@tanstack/react-query";
import { accountSecurityQueryKey } from "@/hooks/queries/user/use-account-security";
import { authClient } from "@/lib/auth-client";

/** Signs out every session except this one. */
function useRevokeOtherSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.revokeOtherSessions();
      if (error) {
        throw new Error(error.message || "Failed to sign out other sessions");
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: accountSecurityQueryKey }),
  });
}

export default useRevokeOtherSessions;
