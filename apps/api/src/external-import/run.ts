import { and, asc, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ColumnGroup } from "../column/groups";
import db from "../database";
import { columnTable } from "../database/schema";
import {
  type JiraProject,
  loadImportedKeys,
  loadJiraProject,
  loadMembers,
} from "../jira-import/context";
import { ensureWorkspaceLabels } from "../jira-import/groups";
import { withJiraImportLock } from "../jira-import/lock";
import { createMemberMatcher } from "../jira-import/mapping";
import { WarningLog } from "../jira-import/warnings";
import {
  createImportedTask,
  type ImportTarget,
  type ResolvedStatus,
  updateImportedTask,
} from "../jira-import/write";
import { loadImportFacts, planImportExtras } from "../task/import-extras";
import { PLANNED_STATUS, taskGroupOf } from "../task/scope";
import createTaskRelation from "../task-relation/controllers/create-task-relation";
import { parseExternalExport } from "./parse";
import { type ExternalPlanContext, planItem, planRelations } from "./plan";
import type { ExternalPermissions } from "./preview";
import type { ExternalImportOptions } from "./schema";
import { type ExternalItem, type ExternalSource, SOURCE_LABELS } from "./types";

// Trello, Linear and Asana imports: the Jira importer's pipeline (one lock
// per project, one transaction per item, relations last) fed by the
// source's parser.

const MAX_LISTED_ERRORS = 200;
const RELATION_EXISTS = "This relation already exists";
const BUSY =
  "Another import into this project is running. Try again when it finishes.";

type BoardColumn = {
  id: string;
  slug: string;
  name: string;
  group: ColumnGroup;
};

async function loadBoardColumns(projectId: string): Promise<BoardColumn[]> {
  return db
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      name: columnTable.name,
      group: columnTable.group,
    })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        ne(columnTable.group, "triage"),
      ),
    )
    .orderBy(asc(columnTable.position));
}

function resolveStatus(
  slug: string,
  columns: readonly BoardColumn[],
  warnings: WarningLog,
): ResolvedStatus {
  const column = columns.find((candidate) => candidate.slug === slug);
  if (column) {
    return {
      status: column.slug,
      columnId: column.id,
      group: taskGroupOf(column.slug, column),
    };
  }
  if (slug !== PLANNED_STATUS) {
    warnings.add(
      "Unknown columns in the status mapping go to the backlog",
      slug,
    );
  }
  return {
    status: PLANNED_STATUS,
    columnId: null,
    group: taskGroupOf(PLANNED_STATUS, null),
  };
}

export async function runExternalImport({
  source,
  projectId,
  content,
  timeZone,
  options,
  userId,
  permissions,
}: {
  source: ExternalSource;
  projectId: string;
  content: string;
  timeZone?: string;
  options: ExternalImportOptions;
  userId: string;
  permissions: ExternalPermissions;
}) {
  if (options.mode === "update" && !permissions.update) {
    throw new HTTPException(403, {
      message: "Updating existing tasks requires task:update permission",
    });
  }
  const project = await loadJiraProject(projectId);
  const { items } = parseExternalExport(source, content, timeZone);
  return withJiraImportLock(
    project.id,
    () => importItems({ source, project, items, options, userId, permissions }),
    BUSY,
  );
}

async function importItems({
  source,
  project,
  items,
  options,
  userId,
  permissions,
}: {
  source: ExternalSource;
  project: JiraProject;
  items: ExternalItem[];
  options: ExternalImportOptions;
  userId: string;
  permissions: ExternalPermissions;
}) {
  const warnings = new WarningLog();
  const sourceLabel = SOURCE_LABELS[source];
  const target: ImportTarget = {
    projectId: project.id,
    workspaceId: project.workspaceId,
    userId,
    source: { id: source, label: sourceLabel },
  };

  const [columns, members, imported] = await Promise.all([
    loadBoardColumns(project.id),
    loadMembers(project.workspaceId),
    loadImportedKeys(
      project.id,
      items.map((item) => item.key),
      source,
    ),
  ]);
  const context: ExternalPlanContext = {
    columns,
    options,
    matchMember: createMemberMatcher(members),
    commentsAllowed: permissions.comments,
    sourceLabel,
  };

  for (const item of items) {
    for (const bad of item.badDates) {
      warnings.add("Unreadable dates are skipped", bad);
    }
  }

  // Items imported before and left alone aren't planned: their labels must
  // not create anything.
  const plans = items.flatMap((item) =>
    item.key && imported.has(item.key) && options.mode === "skip"
      ? []
      : [{ item, planned: planItem(item, context, warnings) }],
  );

  await ensureWorkspaceLabels(
    plans.flatMap(({ planned }) => planned.labels),
    project.workspaceId,
  );
  const extrasInputs = plans.map(({ planned }) => ({ labels: planned.labels }));
  const facts = await loadImportFacts(project, extrasInputs);

  const unmatched = new Set<string>();
  const errors: Array<{ line: number; key: string; message: string }> = [];
  const taskByKey = new Map<string, string>();
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0, comments: 0 };
  const fail = (line: number, key: string, message: string) => {
    counts.failed += 1;
    if (errors.length < MAX_LISTED_ERRORS) errors.push({ line, key, message });
  };

  for (const item of items) {
    const existing = item.key ? imported.get(item.key) : undefined;
    if (existing && options.mode === "skip") {
      counts.skipped += 1;
      taskByKey.set(item.key, existing);
    }
  }

  for (const [index, { item, planned }] of plans.entries()) {
    for (const name of planned.unmatched) unmatched.add(name);
    if (!planned.title) {
      fail(item.line, item.key, "The item has no title");
      continue;
    }
    if (item.key && taskByKey.has(item.key)) {
      fail(item.line, item.key, "The item appears twice in the file");
      continue;
    }

    const existingId = item.key ? imported.get(item.key) : undefined;
    const extras = planImportExtras(extrasInputs[index] ?? {}, facts);
    const status = resolveStatus(planned.status, columns, warnings);
    try {
      if (existingId) {
        const updated = await updateImportedTask({
          target,
          taskId: existingId,
          planned,
          status,
          extras,
        });
        if (!updated) {
          fail(item.line, item.key, "The task imported before is gone");
          continue;
        }
        counts.updated += 1;
        counts.comments += updated.comments;
        taskByKey.set(item.key, existingId);
      } else {
        const created = await createImportedTask({
          target,
          key: item.key,
          planned,
          status,
          extras,
        });
        counts.created += 1;
        counts.comments += created.comments;
        if (item.key) taskByKey.set(item.key, created.taskId);
      }
      for (const warning of extras.warnings) warnings.add(warning);
    } catch (error) {
      if (error instanceof HTTPException && error.status >= 500) throw error;
      fail(
        item.line,
        item.key,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  // Sub-tasks and links once every task exists, through the relation rules
  // (one parent, no loops, at most 200 per task).
  let relations = 0;
  for (const relation of planRelations(items)) {
    const sourceTaskId = taskByKey.get(relation.sourceKey);
    const targetTaskId = taskByKey.get(relation.targetKey);
    if (!sourceTaskId || !targetTaskId) continue;
    try {
      await createTaskRelation({
        sourceTaskId,
        targetTaskId,
        relationType: relation.relationType,
        userId,
        workspaceId: project.workspaceId,
      });
      relations += 1;
    } catch (error) {
      if (!(error instanceof HTTPException)) throw error;
      if (error.message === RELATION_EXISTS) continue;
      warnings.add(
        `Relations skipped: ${error.message}`,
        `${relation.sourceKey} → ${relation.targetKey}`,
      );
    }
  }

  return {
    total: items.length,
    ...counts,
    relations,
    unmatchedPeople: [...unmatched].sort((a, b) => a.localeCompare(b)),
    errors,
    warnings: warnings.list(),
  };
}
