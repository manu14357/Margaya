import { useMutation, useQueryClient } from "@tanstack/react-query";
import createPage, {
  type CreatePageRequest,
} from "@/fetchers/page/create-page";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import { invalidatePageQueries } from "./invalidate-page-queries";

type Variables = NonNullable<CreatePageRequest> & { projectId: string };

/** Creates a page (untitled from the web); the editor opens it next. */
export function useCreatePage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, ...json }: Variables) =>
      createPage(projectId, json),
    onSuccess: (page, { projectId }) => {
      queryClient.setQueryData(pageQueryKeys.detail(page.id), page);
      invalidatePageQueries(queryClient, { projectIds: [projectId] });
    },
  });
}

export default useCreatePage;
