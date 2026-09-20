import type { LucideIcon } from "lucide-react";
import { SquareCheck } from "lucide-react";
import projectIcons from "@/constants/project-icons";

/**
 * How favorites, recents and (later) home widgets show and open an entity.
 * Project and task are built in; feature slices register their own type:
 *
 *   registerEntityLink("cycle", {
 *     icon: () => IterationCw,
 *     path: (entity, workspaceId) =>
 *       `/dashboard/workspace/${workspaceId}/project/${entity.projectId}/cycles/${entity.id}`,
 *   });
 */
export type EntityReference = {
  type: string;
  id: string;
  icon: string | null;
  projectId: string | null;
};

export type EntityLink = {
  icon: (entity: EntityReference) => LucideIcon;
  /** Null when the entity cannot be opened (for example, no project yet). */
  path: (entity: EntityReference, workspaceId: string) => string | null;
};

function projectIcon(name: string | null): LucideIcon {
  return name && Object.hasOwn(projectIcons, name)
    ? projectIcons[name as keyof typeof projectIcons]
    : projectIcons.Layout;
}

const links = new Map<string, EntityLink>([
  [
    "project",
    {
      icon: (entity) => projectIcon(entity.icon),
      path: (entity, workspaceId) =>
        `/dashboard/workspace/${workspaceId}/project/${entity.id}/board`,
    },
  ],
  [
    "task",
    {
      icon: () => SquareCheck,
      path: (entity, workspaceId) =>
        entity.projectId
          ? `/dashboard/workspace/${workspaceId}/project/${entity.projectId}/task/${entity.id}`
          : null,
    },
  ],
]);

/** Registers a type; returns a function that restores the previous one. */
export function registerEntityLink(type: string, link: EntityLink) {
  const previous = links.get(type);
  links.set(type, link);
  return () => {
    if (previous) links.set(type, previous);
    else links.delete(type);
  };
}

export function getEntityLink(type: string): EntityLink | undefined {
  return links.get(type);
}

export function getEntityIcon(entity: EntityReference): LucideIcon {
  return links.get(entity.type)?.icon(entity) ?? projectIcons.Layout;
}

export function getEntityPath(
  entity: EntityReference,
  workspaceId: string,
): string | null {
  return links.get(entity.type)?.path(entity, workspaceId) ?? null;
}
