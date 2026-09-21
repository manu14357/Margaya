import { Layers } from "lucide-react";
import type { EntityLink } from "@/lib/entity-links";

/** A project view's page, or a workspace view under "All tasks". */
export function viewPath(
  workspaceId: string,
  viewId: string,
  projectId: string | null | undefined,
): string {
  return projectId
    ? `/dashboard/workspace/${workspaceId}/project/${projectId}/views/${viewId}`
    : `/dashboard/workspace/${workspaceId}/views/${viewId}`;
}

/** Favorites and recents open a view on its page. */
export const viewEntityLink: EntityLink = {
  icon: () => Layers,
  path: (entity, workspaceId) =>
    viewPath(workspaceId, entity.id, entity.projectId),
};
