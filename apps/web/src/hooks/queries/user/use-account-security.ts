import { useQuery } from "@tanstack/react-query";
import getAccountSecurity from "@/fetchers/user/get-account-security";

export const accountSecurityQueryKey = ["user", "security"] as const;

/** Password state and active sessions of the signed-in user. */
function useAccountSecurity() {
  return useQuery({
    queryKey: accountSecurityQueryKey,
    queryFn: getAccountSecurity,
  });
}

export default useAccountSecurity;
