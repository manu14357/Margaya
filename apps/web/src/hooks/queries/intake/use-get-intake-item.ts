import { useQuery } from "@tanstack/react-query";
import getIntakeItem from "@/fetchers/intake/get-intake-item";
import { intakeQueryKeys } from "./intake-query-keys";

export function useGetIntakeItem(id: string | undefined) {
  return useQuery({
    queryKey: intakeQueryKeys.item(id ?? ""),
    queryFn: () => getIntakeItem(id ?? ""),
    enabled: Boolean(id),
    // 404 means deleted or invisible; retrying won't change that.
    retry: false,
  });
}

export default useGetIntakeItem;
