import { Boxes } from "lucide-react";
import type { EntityLink } from "@/lib/entity-links";

export function modulePath(
  workspaceId: string,
  projectId: string,
  moduleId: string,
): string {
  return `/dashboard/workspace/${workspaceId}/project/${projectId}/modules/${moduleId}`;
}

/** Favorites and recents open a module on its page. */
export const moduleEntityLink: EntityLink = {
  icon: () => Boxes,
  path: (entity, workspaceId) =>
    entity.projectId
      ? modulePath(workspaceId, entity.projectId, entity.id)
      : null,
};
