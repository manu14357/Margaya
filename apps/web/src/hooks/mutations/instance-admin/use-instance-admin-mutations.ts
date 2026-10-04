import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addInstanceAdmin,
  removeInstanceAdmin,
} from "@/fetchers/instance-admin/instance-lists";
import {
  sendInstanceTestEmail,
  updateInstanceSettings,
} from "@/fetchers/instance-admin/instance-settings";
import { unpublishProject } from "@/fetchers/publication/project-publication";
import { instanceAdminKeys } from "@/hooks/queries/instance-admin/use-instance-admin";
import type { InstanceSettingsPatch } from "@/types/instance-admin";

export function useUpdateInstanceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: InstanceSettingsPatch) =>
      updateInstanceSettings(values),
    onSuccess: (settings) => {
      queryClient.setQueryData(instanceAdminKeys.settings(), settings);
      // The sign-in screen, workspace creation and public boards read /config.
      void queryClient.invalidateQueries({ queryKey: ["config"] });
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.overview(),
      });
    },
  });
}

export function useSendInstanceTestEmail() {
  return useMutation({
    mutationFn: (to?: string) => sendInstanceTestEmail(to),
  });
}

export function useAddInstanceAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => addInstanceAdmin(email),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.admins(),
      });
    },
  });
}

export function useRemoveInstanceAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeInstanceAdmin(userId),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.admins(),
      });
    },
  });
}

export function useUnpublishInstanceBoard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => unpublishProject(projectId),
    onSuccess: (_publication, projectId) => {
      void queryClient.invalidateQueries({
        queryKey: [...instanceAdminKeys.all, "public-boards"],
      });
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.overview(),
      });
      void queryClient.invalidateQueries({
        queryKey: ["publication", projectId],
      });
    },
  });
}
