import type { LucideIcon } from "lucide-react";
import { SquareKanban } from "lucide-react";
import type { ProjectFeatureKey } from "@/constants/project-features";

/**
 * Project sections: the tabs under the project header (Tasks, Cycles,
 * Modules, Views, Pages, Intake).
 *
 * Tasks is built in. A feature slice registers its section from its own file:
 *
 *   registerProjectSection({
 *     id: "cycles",
 *     labelKey: "navigation:projectNav.cycles",
 *     icon: IterationCw,
 *     feature: "cycles",
 *     segment: "cycles",
 *     shortcutKey: "c",
 *   });
 *
 * - `segment` is the list route under /project/$projectId/ (for example
 *   routes/.../project/$projectId/cycles/index.tsx); `matchSegments` are the
 *   extra first path segments that also belong to the section.
 * - A section shows only while its `feature` is on for the project and
 *   available in the web app. Order is fixed by `PROJECT_SECTION_ORDER`.
 * - A section can instead (or also) require a workspace capability
 *   (`requires`), e.g. Analytics, which every project has for people with
 *   the analytics permission. `align: "end"` puts it at the strip's end.
 * - `useBadge` may return a count for the tab (intake uses it).
 * - The strip itself appears only when at least one section besides Tasks
 *   shows, so plain projects look exactly as before.
 */
export const PROJECT_SECTION_ORDER = [
  "tasks",
  "cycles",
  "modules",
  "views",
  "pages",
  "intake",
  "analytics",
] as const;

export type ProjectSectionId = (typeof PROJECT_SECTION_ORDER)[number];

/** Workspace capabilities a section can require (use-workspace-permission). */
export type ProjectSectionCapability = "readAnalytics";

export type ProjectSection = {
  id: ProjectSectionId;
  labelKey: `navigation:projectNav.${ProjectSectionId}`;
  icon: LucideIcon;
  /** The gating feature; null for sections every project has (Tasks). */
  feature: ProjectFeatureKey | null;
  /** A capability the viewer needs; hidden without it. */
  requires?: ProjectSectionCapability;
  /** "end" renders the tab after a spacer, at the strip's right end. */
  align?: "start" | "end";
  /** First path segment of the section's list route. */
  segment: string;
  /** Other first path segments that belong to this section. */
  matchSegments?: readonly string[];
  /** Second key after the `g` prefix. */
  shortcutKey?: string;
  useBadge?: (args: {
    projectId: string;
    workspaceId: string;
  }) => number | null | undefined;
  /** The badge's accessible name, given `{{count}}`. */
  badgeAriaKey?: string;
};

export const TASKS_SECTION: ProjectSection = {
  id: "tasks",
  labelKey: "navigation:projectNav.tasks",
  icon: SquareKanban,
  feature: null,
  segment: "board",
  matchSegments: ["board", "backlog", "calendar", "gantt", "task"],
  shortcutKey: "t",
};

const registeredSections = new Map<ProjectSectionId, ProjectSection>();

/** Registers a section; returns a function that removes it (for tests). */
export function registerProjectSection(section: ProjectSection): () => void {
  if (section.id === "tasks") {
    throw new Error("The tasks section is built in");
  }
  registeredSections.set(section.id, section);
  return () => {
    if (registeredSections.get(section.id) === section) {
      registeredSections.delete(section.id);
    }
  };
}

/** Every known section in the fixed order, Tasks first. */
export function getProjectSections(): ProjectSection[] {
  return PROJECT_SECTION_ORDER.flatMap((id) => {
    if (id === "tasks") return [TASKS_SECTION];
    const section = registeredSections.get(id);
    return section ? [section] : [];
  });
}

/**
 * The sections a project shows: Tasks plus those whose feature is on and
 * whose required capability the viewer has.
 */
export function getVisibleProjectSections(
  isFeatureEnabled: (feature: ProjectFeatureKey) => boolean,
  sections: readonly ProjectSection[] = getProjectSections(),
  hasCapability: (capability: ProjectSectionCapability) => boolean = () =>
    false,
): ProjectSection[] {
  return sections.filter(
    (section) =>
      (section.feature === null || isFeatureEnabled(section.feature)) &&
      (!section.requires || hasCapability(section.requires)),
  );
}

/** The strip is worth showing only when there is more than Tasks. */
export function shouldShowSectionStrip(
  visibleSections: readonly ProjectSection[],
): boolean {
  return visibleSections.some((section) => section.id !== "tasks");
}

/**
 * The section a pathname belongs to, from the first segment after
 * /project/$projectId/. Anything unrecognized belongs to Tasks.
 */
export function resolveActiveSection(
  pathname: string,
  sections: readonly ProjectSection[] = getProjectSections(),
): ProjectSectionId {
  const segment = pathname.match(/\/project\/[^/]+\/([^/?#]+)/)?.[1];
  if (!segment) return "tasks";
  const match = sections.find(
    (section) =>
      section.segment === segment || section.matchSegments?.includes(segment),
  );
  return match?.id ?? "tasks";
}

export function projectSectionPath(
  section: Pick<ProjectSection, "segment">,
  workspaceId: string,
  projectId: string,
): string {
  return `/dashboard/workspace/${workspaceId}/project/${projectId}/${section.segment}`;
}
