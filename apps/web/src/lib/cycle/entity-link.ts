import { IterationCw } from "lucide-react";
import type { EntityLink } from "@/lib/entity-links";

/** Favorites and recents open a cycle on its page. */
export const cycleEntityLink: EntityLink = {
  icon: () => IterationCw,
  path: (entity, workspaceId) =>
    entity.projectId
      ? `/dashboard/workspace/${workspaceId}/project/${entity.projectId}/cycles/${entity.id}`
      : null,
};

export function cyclePath(
  workspaceId: string,
  projectId: string,
  cycleId: string,
): string {
  return `/dashboard/workspace/${workspaceId}/project/${projectId}/cycles/${cycleId}`;
}
