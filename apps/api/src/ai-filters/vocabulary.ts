import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { AiScope } from "../ai/context";
import { workspaceLabels } from "../ai-triage/candidates";
import db from "../database";
import {
  columnTable,
  cycleTable,
  moduleTable,
  projectTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import {
  type FilterVocabulary,
  NL_DATE_KEYS,
  type VocabularyEntry,
} from "./resolve";

// The names a natural-language filter may use, read for one caller: only
// projects AI may read, and the statuses, cycles and modules of the one
// project in view. Each gets a short reference the model answers with.

const MAX_PEOPLE = 200;
const MAX_PROJECTS = 100;
const MAX_CYCLES = 50;
const MAX_MODULES = 50;

function refs<T extends { id: string; name: string }>(
  prefix: string,
  rows: readonly T[],
): VocabularyEntry[] {
  return rows.map((row, i) => ({
    ref: `${prefix}${i + 1}`,
    id: row.id,
    name: row.name,
  }));
}

export async function loadFilterVocabulary(
  scope: AiScope,
  projectId: string | null,
): Promise<FilterVocabulary> {
  const projectIds = [...scope.projectIds];
  const [labels, people, projects] = await Promise.all([
    workspaceLabels(scope.workspaceId),
    db
      .select({ id: userTable.id, name: userTable.name })
      .from(workspaceUserTable)
      .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
      .where(eq(workspaceUserTable.workspaceId, scope.workspaceId))
      .orderBy(asc(userTable.name))
      .limit(MAX_PEOPLE),
    projectId || projectIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: projectTable.id, name: projectTable.name })
          .from(projectTable)
          .where(
            and(
              inArray(projectTable.id, projectIds),
              isNull(projectTable.archivedAt),
            ),
          )
          .orderBy(asc(projectTable.position))
          .limit(MAX_PROJECTS),
  ]);

  let statuses: { id: string; name: string }[] = [];
  let cycles: { id: string; name: string }[] = [];
  let modules: { id: string; name: string }[] = [];
  if (projectId) {
    [statuses, cycles, modules] = await Promise.all([
      db
        .select({ id: columnTable.slug, name: columnTable.name })
        .from(columnTable)
        .where(
          and(
            eq(columnTable.projectId, projectId),
            ne(columnTable.group, "triage"),
          ),
        )
        .orderBy(asc(columnTable.position)),
      db
        .select({ id: cycleTable.id, name: cycleTable.name })
        .from(cycleTable)
        .where(
          and(
            eq(cycleTable.projectId, projectId),
            isNull(cycleTable.archivedAt),
          ),
        )
        .orderBy(asc(cycleTable.sortOrder))
        .limit(MAX_CYCLES),
      db
        .select({ id: moduleTable.id, name: moduleTable.name })
        .from(moduleTable)
        .where(
          and(
            eq(moduleTable.projectId, projectId),
            isNull(moduleTable.archivedAt),
          ),
        )
        .orderBy(asc(moduleTable.position))
        .limit(MAX_MODULES),
    ]);
  }

  const keys = new Set<string>([
    "group",
    "priority",
    "assignee",
    "createdBy",
    "label",
    "cycle",
    ...NL_DATE_KEYS,
  ]);
  if (projectId) {
    keys.add("status");
    keys.add("module");
  } else {
    keys.add("project");
  }

  return {
    keys,
    statuses: refs("S", statuses),
    labels: refs("L", labels),
    people: refs(
      "P",
      people.map((person) => ({ id: person.id, name: person.name ?? "" })),
    ),
    cycles: refs("C", cycles),
    modules: refs("M", modules),
    projects: refs("R", projects),
  };
}
