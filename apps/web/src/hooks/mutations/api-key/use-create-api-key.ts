import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type CreateApiKeyInput,
  createApiKey,
} from "@/fetchers/api-key/api-keys";

// Keys are created through the API so their scope (read-only, areas,
// projects) is set on the server, where it can't be widened later.
function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateApiKeyInput) => createApiKey(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

export default useCreateApiKey;
