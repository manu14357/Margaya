import { useQuery } from "@tanstack/react-query";
import getSlackLinks from "@/fetchers/slack-app/get-slack-links";
import { slackAppKeys } from "./slack-app-query-keys";

function useSlackLinks() {
  return useQuery({
    queryKey: slackAppKeys.links(),
    queryFn: getSlackLinks,
  });
}

export default useSlackLinks;
