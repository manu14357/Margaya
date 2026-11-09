import {
  QueryClient,
  QueryClientContext,
  useQuery,
} from "@tanstack/react-query";
import { useContext } from "react";
import { getProjectAudience } from "@/fetchers/project/project-audience";

export const projectAudienceQueryKey = (projectId: string) =>
  ["project-audience", projectId] as const;

// Pickers and assignee chips render in many places, some outside a query
// provider (isolated component tests). With no provider there is nothing to
// fetch, so the query stays off on a client of its own.
const NO_PROVIDER = new QueryClient();

/**
 * The people who can see a project, for pickers inside it (assignees,
 * mentions). A guest gets them too, without the rest of the workspace.
 */
function useProjectAudience(projectId: string | null | undefined) {
  const provided = useContext(QueryClientContext);
  return useQuery(
    {
      queryKey: projectAudienceQueryKey(projectId ?? ""),
      queryFn: () => getProjectAudience(projectId ?? ""),
      enabled: Boolean(projectId && provided),
    },
    provided ?? NO_PROVIDER,
  );
}

export default useProjectAudience;
