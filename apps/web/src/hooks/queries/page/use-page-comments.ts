import { useQuery } from "@tanstack/react-query";
import {
  getPageSubscription,
  listPageComments,
} from "@/fetchers/page/page-comments";
import { pageQueryKeys } from "./page-query-keys";

/** A page's comments, oldest first. */
export function usePageComments(pageId: string) {
  return useQuery({
    queryKey: pageQueryKeys.comments(pageId),
    queryFn: () => listPageComments(pageId),
  });
}

/** Whether the current user watches the page. */
export function usePageSubscription(pageId: string) {
  return useQuery({
    queryKey: pageQueryKeys.subscription(pageId),
    queryFn: () => getPageSubscription(pageId),
  });
}
