import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type CreateModuleLinkRequest,
  createModuleLink,
  deleteModuleLink,
  type UpdateModuleLinkRequest,
  updateModuleLink,
} from "@/fetchers/module/module-links";
import { invalidateModuleQueries } from "./invalidate-module-queries";

// A module's links arrive with its detail, so every link change refreshes
// the module queries.

export function useCreateModuleLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      moduleId,
      json,
    }: {
      moduleId: string;
      projectId: string;
      json: CreateModuleLinkRequest;
    }) => createModuleLink(moduleId, json),
    onSuccess: (_link, { projectId }) => {
      invalidateModuleQueries(queryClient, projectId);
    },
  });
}

export function useUpdateModuleLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      moduleId,
      linkId,
      json,
    }: {
      moduleId: string;
      linkId: string;
      projectId: string;
      json: UpdateModuleLinkRequest;
    }) => updateModuleLink(moduleId, linkId, json),
    onSuccess: (_link, { projectId }) => {
      invalidateModuleQueries(queryClient, projectId);
    },
  });
}

export function useDeleteModuleLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      moduleId,
      linkId,
    }: {
      moduleId: string;
      linkId: string;
      projectId: string;
    }) => deleteModuleLink(moduleId, linkId),
    onSuccess: (_result, { projectId }) => {
      invalidateModuleQueries(queryClient, projectId);
    },
  });
}
