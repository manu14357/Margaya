import type { QueryClient } from "@tanstack/react-query";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import { trashQueryKeys } from "@/hooks/queries/trash/trash-query-keys";
import { notifyPageDeleted } from "./page-events";

type PageHint = { type?: unknown; projectId?: unknown; pageId?: unknown };

function invalidateEntities(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["favorites"] });
  queryClient.invalidateQueries({ queryKey: ["recent-visits"] });
  // A task's "Mentioned in pages" list follows page content, titles,
  // access and deletion; hints carry no task ids, so all refetch.
  queryClient.invalidateQueries({ queryKey: pageQueryKeys.taskReferences() });
}

/**
 * Applies a page hint from the project socket (§5.1): PAGE_UPDATED,
 * PAGES_UPDATED and PAGE_DELETED carry ids only, so the matching queries
 * refetch. Returns false for any other message.
 */
export function handlePageHint(
  queryClient: QueryClient,
  message: PageHint,
): boolean {
  const projectId =
    typeof message.projectId === "string" ? message.projectId : null;
  const pageId = typeof message.pageId === "string" ? message.pageId : null;

  switch (message.type) {
    case "PAGE_UPDATED":
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: pageQueryKeys.list(projectId),
        });
      }
      if (pageId) {
        // The detail, versions and backlinks share the page's prefix.
        queryClient.invalidateQueries({
          queryKey: pageQueryKeys.detail(pageId),
        });
      }
      // Titles and icons show in favorites and recents.
      invalidateEntities(queryClient);
      return true;
    case "PAGES_UPDATED":
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: pageQueryKeys.list(projectId),
        });
      }
      queryClient.invalidateQueries({ queryKey: pageQueryKeys.all() });
      // A page restored from the trash or deleted permanently.
      queryClient.invalidateQueries({ queryKey: trashQueryKeys.all() });
      invalidateEntities(queryClient);
      return true;
    case "PAGE_DELETED":
      if (pageId) {
        queryClient.removeQueries({ queryKey: pageQueryKeys.detail(pageId) });
        notifyPageDeleted(pageId);
      }
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: pageQueryKeys.list(projectId),
        });
      }
      queryClient.invalidateQueries({ queryKey: trashQueryKeys.all() });
      invalidateEntities(queryClient);
      return true;
    default:
      return false;
  }
}
