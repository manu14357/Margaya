import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addProjectUpdateComment,
  type CreateProjectUpdateInput,
  createProjectUpdate,
  deleteProjectUpdate,
  deleteProjectUpdateComment,
  draftProjectUpdate,
  type EditProjectUpdateInput,
  editProjectUpdate,
  type ProjectUpdateReactionKey,
  setProjectUpdateFollow,
  setProjectUpdateReaction,
  setProjectUpdateReminder,
} from "@/fetchers/project-update/project-update";
import { projectUpdateKeys } from "@/hooks/queries/project-update/use-project-updates";

// Mutations for project updates. None of them touch tasks, so they skip the
// global task-query refresh. The socket only updates other tabs; this tab
// refreshes itself here.

const meta = { refreshTaskQueries: false };

function useRefresh(projectId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({
      queryKey: projectUpdateKeys.project(projectId),
    });
    queryClient.invalidateQueries({ queryKey: ["project-updates", "latest"] });
  };
}

export function useCreateProjectUpdate(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    meta,
    mutationFn: (input: CreateProjectUpdateInput) =>
      createProjectUpdate(projectId, input),
    onSuccess: refresh,
  });
}

export function useEditProjectUpdate(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    meta,
    mutationFn: ({ id, ...input }: EditProjectUpdateInput & { id: string }) =>
      editProjectUpdate(id, input),
    onSuccess: refresh,
  });
}

export function useDeleteProjectUpdate(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    meta,
    mutationFn: (id: string) => deleteProjectUpdate(id),
    onSuccess: refresh,
  });
}

/** Facts and a draft; saves nothing, so nothing to refresh. */
export function useDraftProjectUpdate(projectId: string) {
  return useMutation({
    meta,
    mutationFn: (input: { useAi: boolean; locale?: string }) =>
      draftProjectUpdate(projectId, input),
  });
}

export function useAddProjectUpdateComment(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    meta,
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      addProjectUpdateComment(id, content),
    onSuccess: refresh,
  });
}

export function useDeleteProjectUpdateComment(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    meta,
    mutationFn: (commentId: string) => deleteProjectUpdateComment(commentId),
    onSuccess: refresh,
  });
}

export function useToggleProjectUpdateReaction(projectId: string) {
  const refresh = useRefresh(projectId);
  return useMutation({
    meta,
    mutationFn: ({
      id,
      emoji,
      reacted,
    }: {
      id: string;
      emoji: ProjectUpdateReactionKey;
      reacted: boolean;
    }) => setProjectUpdateReaction(id, emoji, !reacted),
    onSuccess: refresh,
  });
}

export function useSetProjectUpdateFollow(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (following: boolean) =>
      setProjectUpdateFollow(projectId, following),
    onSuccess: (data) => {
      queryClient.setQueryData(projectUpdateKeys.follow(projectId), data);
    },
  });
}

export function useSetProjectUpdateReminder(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (input: { enabled: boolean; weekday?: number }) =>
      setProjectUpdateReminder(projectId, input),
    onSuccess: (data) => {
      queryClient.setQueryData(projectUpdateKeys.reminder(projectId), data);
    },
  });
}
