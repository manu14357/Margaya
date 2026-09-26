import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateProjectAutomations from "@/fetchers/project-automation/update-project-automations";
import { projectAutomationQueryKeys } from "@/hooks/queries/project-automation/project-automation-query-keys";
import type {
  ProjectAutomations,
  UpdateProjectAutomationsInput,
} from "@/types/project-automation";

/** Applies a settings patch to the cached automations, for optimism. */
export function applyAutomationPatch(
  current: ProjectAutomations,
  patch: UpdateProjectAutomationsInput,
): ProjectAutomations {
  const autoClose = { ...current.autoClose, ...patch.autoClose };
  return {
    ...current,
    autoArchive: { ...current.autoArchive, ...patch.autoArchive },
    autoClose: {
      ...autoClose,
      columnId:
        patch.autoClose?.columnId !== undefined
          ? patch.autoClose.columnId
          : current.autoClose.columnId,
    },
  };
}

/** Saves automation settings; the switches move at once, and back on error. */
export function useUpdateProjectAutomations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      patch,
    }: {
      workspaceId: string;
      projectId: string;
      patch: UpdateProjectAutomationsInput;
    }) => updateProjectAutomations(projectId, patch),
    onMutate: async ({ workspaceId, projectId, patch }) => {
      const key = projectAutomationQueryKeys.automations(
        workspaceId,
        projectId,
      );
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const previous = queryClient.getQueryData<ProjectAutomations>(key);
      if (previous) {
        queryClient.setQueryData(key, applyAutomationPatch(previous, patch));
      }
      return { previous };
    },
    onError: (_error, { workspaceId, projectId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          projectAutomationQueryKeys.automations(workspaceId, projectId),
          context.previous,
        );
      }
    },
    onSuccess: (saved, { workspaceId, projectId }) => {
      queryClient.setQueryData(
        projectAutomationQueryKeys.automations(workspaceId, projectId),
        saved,
      );
    },
    onSettled: (_saved, _error, { workspaceId, projectId }) => {
      void queryClient.invalidateQueries({
        queryKey: projectAutomationQueryKeys.automations(
          workspaceId,
          projectId,
        ),
        exact: true,
      });
    },
  });
}

export default useUpdateProjectAutomations;
