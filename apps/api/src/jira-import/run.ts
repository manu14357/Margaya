import { and, asc, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ColumnGroup } from "../column/groups";
import db from "../database";
import { columnTable } from "../database/schema";
import { loadImportFacts, planImportExtras } from "../task/import-extras";
import { PLANNED_STATUS, taskGroupOf } from "../task/scope";
import createTaskRelation from "../task-relation/controllers/create-task-relation";
import {
  type JiraProject,
  loadEstimateLookup,
  loadImportedKeys,
  loadJiraProject,
  loadMembers,
  parseJiraExport,
} from "./context";
import {
  ensureCycles,
  ensureModules,
  ensureWorkspaceLabels,
  lookupId,
} from "./groups";
import type { JiraIssue } from "./issues";
import { withJiraImportLock } from "./lock";
import { createMemberMatcher } from "./mapping";
import { type PlanContext, planIssue, planRelations } from "./plan";
import type { JiraPermissions } from "./preview";
import type { JiraImportOptions } from "./schema";
import { WarningLog } from "./warnings";
import {
  createImportedTask,
  type ImportTarget,
  type ResolvedStatus,
  updateImportedTask,
} from "./write";

const MAX_LISTED_ERRORS = 200;
const RELATION_EXISTS = "This relation already exists";

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

function assertAllowed(
  options: JiraImportOptions,
  permissions: JiraPermissions,
) {
  const missing =
    options.mode === "update" && !permissions.update
      ? "Updating existing tasks requires task:update permission"
      : options.sprintsAsCycles && !permissions.cycles
        ? "Importing sprints as cycles requires cycle:create permission"
        : options.componentsAsModules && !permissions.modules
          ? "Importing components as modules requires module:create permission"
          : null;
  if (missing) throw new HTTPException(403, { message: missing });
}

export async function runJiraImport({
  projectId,
  content,
  timeZone,
  options,
  userId,
  permissions,
}: {
  projectId: string;
  content: string;
  timeZone?: string;
  options: JiraImportOptions;
  userId: string;
  permissions: JiraPermissions;
}) {
  assertAllowed(options, permissions);
  const project = await loadJiraProject(projectId);
  const { issues } = parseJiraExport(content, timeZone);
  return withJiraImportLock(project.id, () =>
    importIssues({ project, issues, options, userId, permissions }),
  );
}

async function importIssues({
  project,
  issues,
  options,
  userId,
  permissions,
}: {
  project: JiraProject;
  issues: JiraIssue[];
  options: JiraImportOptions;
  userId: string;
  permissions: JiraPermissions;
}) {
  const warnings = new WarningLog();
  const target: ImportTarget = {
    projectId: project.id,
    workspaceId: project.workspaceId,
    userId,
  };

  const [columns, members, imported, estimate] = await Promise.all([
    loadBoardColumns(project.id),
    loadMembers(project.workspaceId),
    loadImportedKeys(
      project.id,
      issues.map((issue) => issue.key),
    ),
    loadEstimateLookup(project),
  ]);
  const matchMember = createMemberMatcher(members);
  const context: PlanContext = {
    columns,
    options,
    matchMember,
    estimate: { enabled: project.estimatesEnabled, ...estimate },
    cyclesOn: project.cyclesEnabled,
    modulesOn: project.modulesEnabled,
    commentsAllowed: permissions.comments,
  };

  // Issues imported before and left alone aren't planned: their sprints,
  // components and labels must not create anything.
  const plans = issues.flatMap((issue) =>
    issue.key && imported.has(issue.key) && options.mode === "skip"
      ? []
      : [{ issue, planned: planIssue(issue, context, warnings) }],
  );

  // Shared names first: cycles, modules and workspace labels.
  const cycleIds = await ensureCycles(
    plans.flatMap(({ planned }) => planned.cycleName ?? []),
    project,
    userId,
    warnings,
  );
  const moduleIds = await ensureModules(
    plans.flatMap(({ planned }) => planned.moduleNames),
    project,
    userId,
    warnings,
  );
  await ensureWorkspaceLabels(
    plans.flatMap(({ planned }) => planned.labels),
    project.workspaceId,
  );
  const extrasInputs = plans.map(({ planned }) => ({
    labels: planned.labels,
    cycleId: planned.cycleName
      ? (lookupId(cycleIds, planned.cycleName) ?? undefined)
      : undefined,
    moduleIds: planned.moduleNames.flatMap(
      (name) => lookupId(moduleIds, name) ?? [],
    ),
    estimatePointId: planned.estimatePointId ?? undefined,
  }));
  const facts = await loadImportFacts(project, extrasInputs);

  const unmatched = new Set<string>();
  const errors: Array<{ line: number; key: string; message: string }> = [];
  const taskByKey = new Map<string, string>();
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0, comments: 0 };
  const fail = (line: number, key: string, message: string) => {
    counts.failed += 1;
    if (errors.length < MAX_LISTED_ERRORS) errors.push({ line, key, message });
  };

  for (const issue of issues) {
    const existing = issue.key ? imported.get(issue.key) : undefined;
    if (existing && options.mode === "skip") {
      counts.skipped += 1;
      taskByKey.set(issue.key, existing);
    }
  }

  for (const [index, { issue, planned }] of plans.entries()) {
    if (issue.assignee && !planned.assigneeId) unmatched.add(issue.assignee);
    if (issue.reporter && !planned.reporterId) unmatched.add(issue.reporter);
    if (!planned.title) {
      fail(issue.line, issue.key, "The issue has no Summary");
      continue;
    }
    if (issue.key && taskByKey.has(issue.key)) {
      fail(issue.line, issue.key, "The issue key appears twice in the file");
      continue;
    }

    const existingId = issue.key ? imported.get(issue.key) : undefined;
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
          fail(issue.line, issue.key, "The task imported before is gone");
          continue;
        }
        counts.updated += 1;
        counts.comments += updated.comments;
        taskByKey.set(issue.key, existingId);
      } else {
        const created = await createImportedTask({
          target,
          key: issue.key,
          planned,
          status,
          extras,
        });
        counts.created += 1;
        counts.comments += created.comments;
        if (issue.key) taskByKey.set(issue.key, created.taskId);
      }
      for (const warning of extras.warnings) warnings.add(warning);
    } catch (error) {
      if (error instanceof HTTPException && error.status >= 500) throw error;
      fail(
        issue.line,
        issue.key,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  // Sub-tasks and links once every task exists, through the relation
  // rules (one parent, no loops, at most 200 per task).
  let relations = 0;
  for (const relation of planRelations(issues)) {
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
    total: issues.length,
    ...counts,
    relations,
    unmatchedPeople: [...unmatched].sort((a, b) => a.localeCompare(b)),
    errors,
    warnings: warnings.list(),
  };
}
