import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import createCycle from "../cycle/controllers/create-cycle";
import db from "../database";
import { cycleTable, labelTable, moduleTable } from "../database/schema";
import createModule from "../module/controllers/create-module";
import type { WarningLog } from "./warnings";

// Cycles, modules and workspace labels the import refers to by name: found
// case-insensitively, or created once before the tasks are written.

const DEFAULT_LABEL_COLOR = "gray";

function key(name: string) {
  return name.trim().toLowerCase();
}

/** Cycle name → id; missing cycles are created without dates (drafts). */
export async function ensureCycles(
  names: readonly string[],
  project: { id: string; workspaceId: string },
  userId: string,
  warnings: WarningLog,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (names.length === 0) return ids;
  const existing = await db
    .select({ id: cycleTable.id, name: cycleTable.name })
    .from(cycleTable)
    .where(
      and(eq(cycleTable.projectId, project.id), isNull(cycleTable.archivedAt)),
    );
  for (const cycle of existing) {
    if (!ids.has(key(cycle.name))) ids.set(key(cycle.name), cycle.id);
  }
  for (const name of new Set(names)) {
    if (ids.has(key(name))) continue;
    try {
      const created = await createCycle({
        projectId: project.id,
        workspaceId: project.workspaceId,
        userId,
        name,
      });
      ids.set(key(name), created.id);
    } catch (error) {
      if (!(error instanceof HTTPException)) throw error;
      warnings.add(`Cycle "${name}" couldn't be created: ${error.message}`);
    }
  }
  return ids;
}

/** Module name → id; names are unique per project, archived ones included. */
export async function ensureModules(
  names: readonly string[],
  project: { id: string; workspaceId: string },
  userId: string,
  warnings: WarningLog,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (names.length === 0) return ids;
  const load = async () => {
    const rows = await db
      .select({ id: moduleTable.id, name: moduleTable.name })
      .from(moduleTable)
      .where(eq(moduleTable.projectId, project.id));
    for (const row of rows) ids.set(key(row.name), row.id);
  };
  await load();
  for (const name of new Set(names)) {
    if (ids.has(key(name))) continue;
    try {
      const created = await createModule({
        projectId: project.id,
        workspaceId: project.workspaceId,
        userId,
        input: { name },
      });
      ids.set(key(name), created.id);
    } catch (error) {
      if (!(error instanceof HTTPException)) throw error;
      // A module created meanwhile under the same name is reused.
      await load();
      if (!ids.has(key(name))) {
        warnings.add(`Module "${name}" couldn't be created: ${error.message}`);
      }
    }
  }
  return ids;
}

/**
 * Creates the workspace labels the import introduces, so they show up in
 * label pickers; names matching an existing label (any case) are reused.
 */
export async function ensureWorkspaceLabels(
  names: readonly string[],
  workspaceId: string,
) {
  if (names.length === 0) return;
  const existing = await db
    .select({ name: labelTable.name })
    .from(labelTable)
    .where(
      and(eq(labelTable.workspaceId, workspaceId), isNull(labelTable.taskId)),
    );
  const known = new Set(existing.map((label) => key(label.name)));
  const missing = new Map<string, string>();
  for (const name of names) {
    if (!known.has(key(name)) && !missing.has(key(name))) {
      missing.set(key(name), name);
    }
  }
  if (missing.size === 0) return;
  await db
    .insert(labelTable)
    .values(
      [...missing.values()].map((name) => ({
        name,
        color: DEFAULT_LABEL_COLOR,
        workspaceId,
        taskId: null,
      })),
    )
    .onConflictDoNothing();
}

export function lookupId(ids: ReadonlyMap<string, string>, name: string) {
  return ids.get(key(name)) ?? null;
}
