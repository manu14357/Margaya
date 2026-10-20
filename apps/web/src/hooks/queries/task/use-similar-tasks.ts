import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getSimilarTasks } from "@/fetchers/task/get-similar-tasks";
import { similarTasksQuery } from "@/lib/similar-tasks";

const DEBOUNCE_MS = 400;

/**
 * Open tasks like the title being typed, after a pause in typing and only
 * for titles of three or more words. Failures stay quiet: hints never
 * block creating a task.
 */
export function useSimilarTasks(
  projectId: string | undefined,
  title: string,
  enabled = true,
) {
  const query = similarTasksQuery(title);
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query]);

  const active = enabled && Boolean(projectId) && debounced !== null;
  const result = useQuery({
    queryKey: ["tasks", projectId, "similar", debounced],
    queryFn: ({ signal }) =>
      getSimilarTasks(projectId ?? "", debounced ?? "", signal),
    enabled: active,
    retry: false,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  return active && query !== null ? (result.data?.tasks ?? []) : [];
}
