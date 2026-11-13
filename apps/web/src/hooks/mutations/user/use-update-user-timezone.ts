import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateUserTimezone from "@/fetchers/user/update-user-timezone";
import { userTimezoneQueryKey } from "@/hooks/queries/user/use-user-timezone";

function useUpdateUserTimezone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateUserTimezone,
    onSuccess: (saved) => {
      queryClient.setQueryData(userTimezoneQueryKey, saved);
      // Member profiles show each person's local time.
      void queryClient.invalidateQueries({ queryKey: ["workspace-member"] });
    },
  });
}

export default useUpdateUserTimezone;
