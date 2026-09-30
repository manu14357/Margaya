import { useQuery } from "@tanstack/react-query";
import getModule from "@/fetchers/module/get-module";
import { HttpError } from "@/lib/http-error";
import { moduleQueryKeys } from "./module-query-keys";

function isClientError(error: unknown) {
  return (
    error instanceof HttpError && error.status >= 400 && error.status < 500
  );
}

export function useGetModule(projectId: string, moduleId: string) {
  return useQuery({
    queryKey: moduleQueryKeys.detail(projectId, moduleId),
    queryFn: () => getModule(moduleId),
    enabled: Boolean(projectId && moduleId),
    // A deleted or foreign module stays missing; don't retry it.
    retry: (failureCount, error) => !isClientError(error) && failureCount < 2,
  });
}

export default useGetModule;
