// Pure rules of the Archives screen (B11 §1.5): which tabs show, the tab a
// URL may ask for, and how bulk restores are split.

import type { ArchivedEntityType, ArchiveSummary } from "@/types/archive";

export const ARCHIVE_TABS = ["tasks", "cycles", "modules", "projects"] as const;

export type ArchiveTab = (typeof ARCHIVE_TABS)[number];

export type EntityArchiveTab = Exclude<ArchiveTab, "tasks">;

export const ARCHIVED_TYPE_OF_TAB: Record<
  EntityArchiveTab,
  ArchivedEntityType
> = {
  cycles: "cycle",
  modules: "module",
  projects: "project",
};

/** Bulk restore and delete send at most this many task ids per request. */
export const ARCHIVE_BULK_CHUNK = 200;

export function isArchiveTab(value: unknown): value is ArchiveTab {
  return (
    typeof value === "string" &&
    (ARCHIVE_TABS as readonly string[]).includes(value)
  );
}

/**
 * Tabs whose count the server returned (null hides a tab: no permission, a
 * feature off everywhere in scope, or projects inside a project). Until the
 * summary loads, only Tasks shows.
 */
export function visibleArchiveTabs(
  summary: ArchiveSummary | undefined,
  scope: "workspace" | "project",
): ArchiveTab[] {
  if (!summary) return ["tasks"];
  return ARCHIVE_TABS.filter(
    (tab) =>
      summary[tab] !== null && (tab !== "projects" || scope === "workspace"),
  );
}

/** The requested tab when it shows, else Tasks. */
export function resolveArchiveTab(
  requested: ArchiveTab,
  visible: readonly ArchiveTab[],
): ArchiveTab {
  return visible.includes(requested) ? requested : "tasks";
}

type CountedIds = { taskIds: string[]; count: number };

function stripIds<G extends CountedIds>(
  group: G,
  hidden: ReadonlySet<string>,
): G {
  const taskIds = group.taskIds.filter((id) => !hidden.has(id));
  const removed = group.taskIds.length - taskIds.length;
  return removed === 0
    ? group
    : { ...group, taskIds, count: Math.max(0, group.count - removed) };
}

/**
 * A task query result without some tasks: restored rows leave the list at
 * once, before the refetch confirms it.
 */
export function withoutTaskIds<
  R extends {
    totalCount: number;
    tasks: Record<string, unknown>;
    groups: Array<CountedIds & { subGroups?: CountedIds[] }>;
  },
>(data: R, hidden: ReadonlySet<string>): R {
  if (hidden.size === 0) return data;
  const removed = [...hidden].filter((id) => id in data.tasks).length;
  if (removed === 0) return data;
  return {
    ...data,
    totalCount: Math.max(0, data.totalCount - removed),
    groups: data.groups.map((group) => {
      const stripped = stripIds(group, hidden);
      return group.subGroups
        ? {
            ...stripped,
            subGroups: group.subGroups.map((cell) => stripIds(cell, hidden)),
          }
        : stripped;
    }),
  };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
