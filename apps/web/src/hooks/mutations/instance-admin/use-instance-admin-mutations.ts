import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addInstanceAdmin,
  banInstanceUser,
  removeInstanceAdmin,
  resetInstanceUserPassword,
  resetInstanceUserTwoFactor,
  revokeInstanceUserSessions,
  unbanInstanceUser,
} from "@/fetchers/instance-admin/instance-lists";
import {
  confirmInstanceAdminPassword,
  sendInstanceTestEmail,
  updateInstanceSettings,
} from "@/fetchers/instance-admin/instance-settings";
import { unpublishProject } from "@/fetchers/publication/project-publication";
import { instanceAdminKeys } from "@/hooks/queries/instance-admin/use-instance-admin";
import { withReauth } from "@/lib/reauth";
import type { InstanceSettingsPatch } from "@/types/instance-admin";

export function useUpdateInstanceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: InstanceSettingsPatch) =>
      withReauth(() => updateInstanceSettings(values)),
    onSuccess: (settings) => {
      queryClient.setQueryData(instanceAdminKeys.settings(), settings);
      // The sign-in screen, workspace creation and public boards read /config.
      void queryClient.invalidateQueries({ queryKey: ["config"] });
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.overview(),
      });
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.auditLog(),
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
    mutationFn: (email: string) => withReauth(() => addInstanceAdmin(email)),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.admins(),
      });
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.auditLog(),
      });
    },
  });
}

export function useRemoveInstanceAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      withReauth(() => removeInstanceAdmin(userId)),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.admins(),
      });
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.auditLog(),
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

export function useConfirmInstanceAdminPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => confirmInstanceAdminPassword(password),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.auditLog(),
      });
    },
  });
}

type UserAction =
  | {
      type: "ban";
      userId: string;
      reason?: string;
      expiresInDays?: number | null;
    }
  | { type: "unban"; userId: string }
  | { type: "revokeSessions"; userId: string }
  | { type: "resetPassword"; userId: string; password?: string }
  | { type: "resetTwoFactor"; userId: string };

function runUserAction(action: UserAction) {
  switch (action.type) {
    case "ban":
      return banInstanceUser(action.userId, {
        reason: action.reason,
        expiresInDays: action.expiresInDays ?? null,
      });
    case "unban":
      return unbanInstanceUser(action.userId);
    case "revokeSessions":
      return revokeInstanceUserSessions(action.userId);
    case "resetPassword":
      return resetInstanceUserPassword(
        action.userId,
        action.password ? { password: action.password } : {},
      );
    case "resetTwoFactor":
      return resetInstanceUserTwoFactor(action.userId);
  }
}

/** Ban, unban, sign out everywhere, reset a password or two-factor (4.12). */
export function useInstanceUserAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: UserAction) => withReauth(() => runUserAction(action)),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.users(),
      });
      void queryClient.invalidateQueries({
        queryKey: instanceAdminKeys.auditLog(),
      });
    },
  });
}
