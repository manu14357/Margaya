import { useCallback, useMemo } from "react";
import {
  isProjectFeatureEnabled,
  PROJECT_FEATURES,
  type ProjectFeatureKey,
} from "@/constants/project-features";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";

/**
 * A project's feature flags. `isEnabled` is false while the project loads and
 * for features the web app does not ship yet, so gated UI never flashes.
 */
export function useProjectFeatures({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const {
    data: project,
    isLoading,
    isError,
    refetch,
  } = useGetProject({
    id: projectId,
    workspaceId,
  });

  const isEnabled = useCallback(
    (key: ProjectFeatureKey) => isProjectFeatureEnabled(project, key),
    [project],
  );

  const flags = useMemo(
    () =>
      Object.fromEntries(
        PROJECT_FEATURES.map((feature) => [
          feature.key,
          isProjectFeatureEnabled(project, feature.key),
        ]),
      ) as Record<ProjectFeatureKey, boolean>,
    [project],
  );

  return { project, flags, isEnabled, isLoading, isError, refetch };
}

/** Feature checks for any project in the workspace, read from the list. */
export function useWorkspaceProjectFeatures(workspaceId: string) {
  const { data: projects } = useGetProjects({ workspaceId });

  return useCallback(
    (projectId: string, key: ProjectFeatureKey) =>
      isProjectFeatureEnabled(
        projects?.find((project) => project.id === projectId),
        key,
      ),
    [projects],
  );
}
