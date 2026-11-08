import { useMutation, useQueryClient } from "@tanstack/react-query";
import { withPushKeptOnThisDevice } from "@/hooks/mutations/notification-preferences/use-push-subscription";
import { PUSH_STATUS_QUERY_KEY } from "@/hooks/queries/notification-preferences/use-get-push-status";
import { accountSecurityQueryKey } from "@/hooks/queries/user/use-account-security";
import { authClient } from "@/lib/auth-client";

type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
};

/** Better Auth's code for a wrong current password. */
export const INVALID_PASSWORD = "INVALID_PASSWORD";

export class ChangePasswordError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ChangePasswordError";
    this.code = code;
  }
}

function useChangePassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      currentPassword,
      newPassword,
      revokeOtherSessions,
    }: ChangePasswordRequest) => {
      const change = async () => {
        const { error } = await authClient.changePassword({
          currentPassword,
          newPassword,
          revokeOtherSessions,
        });

        if (error) {
          throw new ChangePasswordError(
            error.message || "Failed to change password",
            error.code,
          );
        }
      };
      await (revokeOtherSessions ? withPushKeptOnThisDevice(change) : change());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PUSH_STATUS_QUERY_KEY });
      return queryClient.invalidateQueries({
        queryKey: accountSecurityQueryKey,
      });
    },
  });
}

export default useChangePassword;
