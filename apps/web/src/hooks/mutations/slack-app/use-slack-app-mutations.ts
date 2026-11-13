import { useMutation, useQueryClient } from "@tanstack/react-query";
import confirmSlackLink from "@/fetchers/slack-app/confirm-slack-link";
import connectSlackApp, {
  type ConnectSlackAppRequest,
} from "@/fetchers/slack-app/connect-slack-app";
import deleteSlackLink from "@/fetchers/slack-app/delete-slack-link";
import disconnectSlackApp from "@/fetchers/slack-app/disconnect-slack-app";
import testSlackApp from "@/fetchers/slack-app/test-slack-app";
import updateSlackApp, {
  type UpdateSlackAppRequest,
} from "@/fetchers/slack-app/update-slack-app";
import { slackAppKeys } from "@/hooks/queries/slack-app/slack-app-query-keys";

// None of these change tasks, so the global task refresh is skipped.
const meta = { refreshTaskQueries: false };

export function useConnectSlackApp(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (json: ConnectSlackAppRequest) =>
      connectSlackApp(workspaceId, json),
    onSuccess: (data) => {
      queryClient.setQueryData(slackAppKeys.workspace(workspaceId), data);
    },
  });
}

export function useUpdateSlackApp(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (json: UpdateSlackAppRequest) =>
      updateSlackApp(workspaceId, json),
    onSuccess: (data) => {
      queryClient.setQueryData(slackAppKeys.workspace(workspaceId), data);
    },
  });
}

export function useDisconnectSlackApp(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: () => disconnectSlackApp(workspaceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: slackAppKeys.workspace(workspaceId),
      });
    },
  });
}

export function useTestSlackApp(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: () => testSlackApp(workspaceId),
    onSettled: () => {
      // A passing test records the Slack workspace's name.
      void queryClient.invalidateQueries({
        queryKey: slackAppKeys.workspace(workspaceId),
      });
    },
  });
}

export function useConfirmSlackLink() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (token: string) => confirmSlackLink(token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: slackAppKeys.all });
    },
  });
}

export function useDeleteSlackLink() {
  const queryClient = useQueryClient();
  return useMutation({
    meta,
    mutationFn: (id: string) => deleteSlackLink(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: slackAppKeys.links() });
    },
  });
}
