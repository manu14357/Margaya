import { useQuery } from "@tanstack/react-query";
import getDescriptionVersion from "@/fetchers/task-description-version/get-description-version";
import { descriptionVersionKeys } from "./keys";

/** One saved version's text. Versions only change by coalescing saves. */
export function useDescriptionVersion(
  taskId: string,
  versionId: string | undefined,
) {
  return useQuery({
    queryKey: descriptionVersionKeys.detail(taskId, versionId ?? ""),
    queryFn: () => getDescriptionVersion(taskId, versionId ?? ""),
    enabled: Boolean(taskId && versionId),
  });
}
