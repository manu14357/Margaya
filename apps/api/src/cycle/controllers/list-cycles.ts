import { and, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import db from "../../database";
import { cycleTable } from "../../database/schema";
import { escapeLikePattern } from "../../search/like-pattern";
import { projectToday } from "../../utils/timezone";
import { countsByCycle } from "../queries";
import type { CycleListView } from "../schema";
import type { CycleStatus } from "../types";
import { type CycleResponse, selectCycles, toCycle } from "./shared";

export const MAX_LISTED_CYCLES = 1000;

const STATUS_RANK: Record<CycleStatus, number> = {
  current: 0,
  upcoming: 1,
  draft: 2,
  completed: 3,
};

const VIEW_STATUSES: Record<
  Exclude<CycleListView, "all" | "archived">,
  readonly CycleStatus[]
> = {
  current: ["current"],
  upcoming: ["upcoming"],
  draft: ["draft"],
  completed: ["completed"],
  incomplete: ["current", "upcoming", "draft"],
};

function compareWithinStatus(a: CycleResponse, b: CycleResponse): number {
  switch (a.status) {
    case "current":
    case "upcoming":
      return (a.startDate ?? "").localeCompare(b.startDate ?? "");
    case "draft":
      return (
        a.sortOrder - b.sortOrder ||
        b.createdAt.getTime() - a.createdAt.getTime()
      );
    case "completed":
      return (b.endDate ?? "").localeCompare(a.endDate ?? "");
  }
}

/** Current, upcoming, draft, completed; each status in its own order. */
export function compareCycles(a: CycleResponse, b: CycleResponse): number {
  return (
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    compareWithinStatus(a, b) ||
    a.id.localeCompare(b.id)
  );
}

function compareArchived(a: CycleResponse, b: CycleResponse): number {
  return (
    (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

async function listCycles(
  projectId: string,
  { view = "all", search }: { view?: CycleListView; search?: string },
): Promise<CycleResponse[]> {
  const today = await projectToday(projectId);
  const rows = await selectCycles(
    db,
    and(
      eq(cycleTable.projectId, projectId),
      view === "archived"
        ? isNotNull(cycleTable.archivedAt)
        : isNull(cycleTable.archivedAt),
      search
        ? ilike(cycleTable.name, `%${escapeLikePattern(search)}%`)
        : undefined,
    ),
  );
  if (rows.length === 0) return [];

  const counts = await countsByCycle(db, eq(cycleTable.projectId, projectId));
  const cycles = rows.map((row) => toCycle(row, counts.get(row.id), today));

  if (view === "archived") {
    return cycles.sort(compareArchived).slice(0, MAX_LISTED_CYCLES);
  }

  const statuses = view === "all" ? null : VIEW_STATUSES[view];
  return cycles
    .filter((cycle) => !statuses || statuses.includes(cycle.status))
    .sort(compareCycles)
    .slice(0, MAX_LISTED_CYCLES);
}

export default listCycles;
