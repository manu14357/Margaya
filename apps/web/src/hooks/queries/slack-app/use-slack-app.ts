import { useQuery } from "@tanstack/react-query";
import getSlackApp from "@/fetchers/slack-app/get-slack-app";
import { slackAppKeys } from "./slack-app-query-keys";

function useSlackApp(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: slackAppKeys.workspace(workspaceId ?? ""),
    queryFn: () => getSlackApp(workspaceId ?? ""),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export default useSlackApp;
