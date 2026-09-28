import { useQuery } from "@tanstack/react-query";
import listDescriptionVersions from "@/fetchers/task-description-version/list-description-versions";
import { descriptionVersionKeys } from "./keys";

/** A task description's saved versions, while the history is open. */
export function useDescriptionVersions(taskId: string, enabled = true) {
  return useQuery({
    queryKey: descriptionVersionKeys.list(taskId),
    queryFn: () => listDescriptionVersions(taskId),
    enabled: enabled && Boolean(taskId),
  });
}
