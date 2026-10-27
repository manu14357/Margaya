import { useQuery } from "@tanstack/react-query";
import { listApiKeys } from "@/fetchers/api-key/api-keys";

function useGetApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: listApiKeys,
  });
}

export default useGetApiKeys;
