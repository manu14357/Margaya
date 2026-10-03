import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  submitPublicBoardRequest,
  withdrawPublicBoardRequest,
} from "@/fetchers/public-board/public-board-requests";
import { publicBoardKeys } from "@/hooks/queries/public-board/public-board-keys";

const meta = { refreshTaskQueries: false };

/** Send a request to the project's intake, and withdraw an open one. */
export function usePublicBoardRequestMutations(token: string) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: publicBoardKeys.myRequests(token),
    });

  const submit = useMutation({
    mutationFn: (input: { title: string; description?: string }) =>
      submitPublicBoardRequest(token, input),
    onSuccess: () => void refresh(),
    meta,
  });
  const withdraw = useMutation({
    mutationFn: (requestId: string) =>
      withdrawPublicBoardRequest(token, requestId),
    onSuccess: () => void refresh(),
    meta,
  });

  return { submit, withdraw };
}
