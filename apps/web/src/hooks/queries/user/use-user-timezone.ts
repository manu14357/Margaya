import { useQuery } from "@tanstack/react-query";
import getUserTimezone from "@/fetchers/user/get-user-timezone";

export const userTimezoneQueryKey = ["user", "timezone"] as const;

/** The signed-in user's stored time zone (null until they choose one). */
function useUserTimezone({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: userTimezoneQueryKey,
    queryFn: getUserTimezone,
    enabled,
  });
}

export default useUserTimezone;
