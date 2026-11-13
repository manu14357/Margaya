import { useQuery } from "@tanstack/react-query";
import previewSlackLink from "@/fetchers/slack-app/preview-slack-link";
import { slackAppKeys } from "./slack-app-query-keys";

function useSlackLinkPreview(token: string | undefined) {
  return useQuery({
    queryKey: slackAppKeys.linkPreview(token ?? ""),
    queryFn: () => previewSlackLink(token ?? ""),
    enabled: Boolean(token),
    retry: false,
  });
}

export default useSlackLinkPreview;
