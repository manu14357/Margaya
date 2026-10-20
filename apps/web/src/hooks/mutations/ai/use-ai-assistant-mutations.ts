import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type AiFeedbackInput, sendAiFeedback } from "@/fetchers/ai/feedback";
import {
  type AiMemoryInput,
  type AiMemoryPatch,
  createAiMemory,
  deleteAiMemory,
  updateAiMemory,
} from "@/fetchers/ai/memory";
import {
  type AiSkillInput,
  type AiSkillPatch,
  createAiSkill,
  deleteAiSkill,
  updateAiSkill,
} from "@/fetchers/ai/skills";
import { aiKeys } from "@/hooks/queries/ai/use-ai";

export function useSendAiFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AiFeedbackInput) => sendAiFeedback(input),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({
        queryKey: ["ai", "usage", input.workspaceId],
      });
    },
  });
}

export function useCreateAiSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AiSkillInput) => createAiSkill(input),
    onSuccess: (_skill, input) => {
      void queryClient.invalidateQueries({
        queryKey: aiKeys.skills(input.workspaceId),
      });
    },
  });
}

export function useUpdateAiSkill(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AiSkillPatch }) =>
      updateAiSkill(workspaceId, id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: aiKeys.skills(workspaceId),
      });
    },
  });
}

export function useDeleteAiSkill(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAiSkill(workspaceId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: aiKeys.skills(workspaceId),
      });
    },
  });
}

export function useCreateAiMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AiMemoryInput) => createAiMemory(input),
    onSuccess: (_note, input) => {
      void queryClient.invalidateQueries({
        queryKey: aiKeys.memory(input.workspaceId),
      });
    },
  });
}

export function useUpdateAiMemory(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AiMemoryPatch }) =>
      updateAiMemory(workspaceId, id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: aiKeys.memory(workspaceId),
      });
    },
  });
}

export function useDeleteAiMemory(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAiMemory(workspaceId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: aiKeys.memory(workspaceId),
      });
    },
  });
}
