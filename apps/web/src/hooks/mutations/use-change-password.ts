import { useMutation, useQueryClient } from "@tanstack/react-query";
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
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: accountSecurityQueryKey }),
  });
}

export default useChangePassword;
