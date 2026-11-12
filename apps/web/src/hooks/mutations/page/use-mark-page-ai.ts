import { useMutation, useQueryClient } from "@tanstack/react-query";
import markPageAi from "@/fetchers/page/mark-page-ai";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import type { AiAssistFeature } from "@/lib/ai/provenance";

/**
 * Labels a page AI-generated once AI text is accepted in its live editor.
 * The label is a disclosure, so a failure is not worth interrupting the
 * person for; the text itself is already saved through the editor.
 */
export function useMarkPageAi(pageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { refreshTaskQueries: false },
    mutationFn: (feature: AiAssistFeature) => markPageAi(pageId, feature),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: pageQueryKeys.detail(pageId),
        exact: true,
      });
    },
    onError: (error) => {
      console.error("Failed to label the page as AI-generated:", error);
    },
  });
}
