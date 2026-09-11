import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import db from "../../database";
import { moduleMemberTable, moduleTable } from "../../database/schema";
import { escapeLikePattern } from "../../search/like-pattern";
import { countsByModule, memberIdsByModule } from "../queries";
import type { ModuleListView } from "../schema";
import type { ModuleStatus } from "../types";
import { type ModuleResponse, selectModules, toModule } from "./shared";

export const MAX_LISTED_MODULES = 1000;

/** Manual order: position, then newest first. Also the reorder rank. */
export const MODULE_ORDER = [
  asc(moduleTable.position),
  desc(moduleTable.createdAt),
  asc(moduleTable.id),
];

const ARCHIVED_ORDER = [desc(moduleTable.archivedAt), asc(moduleTable.id)];

export type ListModulesFilters = {
  view?: ModuleListView;
  status?: ModuleStatus[];
  leadId?: string;
  memberId?: string;
  search?: string;
};

async function listModules(
  projectId: string,
  { view = "active", status, leadId, memberId, search }: ListModulesFilters,
): Promise<ModuleResponse[]> {
  const rows = await selectModules(
    db,
    and(
      eq(moduleTable.projectId, projectId),
      view === "archived"
        ? isNotNull(moduleTable.archivedAt)
        : isNull(moduleTable.archivedAt),
      status?.length ? inArray(moduleTable.status, status) : undefined,
      leadId ? eq(moduleTable.leadId, leadId) : undefined,
      memberId
        ? exists(
            db
              .select({ id: moduleMemberTable.id })
              .from(moduleMemberTable)
              .where(
                and(
                  eq(moduleMemberTable.moduleId, moduleTable.id),
                  eq(moduleMemberTable.userId, memberId),
                ),
              ),
          )
        : undefined,
      search
        ? ilike(moduleTable.name, `%${escapeLikePattern(search)}%`)
        : undefined,
    ),
    view === "archived" ? ARCHIVED_ORDER : MODULE_ORDER,
    MAX_LISTED_MODULES,
  );
  if (rows.length === 0) return [];

  const counts = await countsByModule(db, eq(moduleTable.projectId, projectId));
  const members = await memberIdsByModule(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) =>
    toModule(row, counts.get(row.id), members.get(row.id) ?? []),
  );
}

export default listModules;
