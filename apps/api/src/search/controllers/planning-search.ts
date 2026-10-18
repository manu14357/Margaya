import { and, desc, eq, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import db from "../../database";
import {
  cycleTable,
  intakeItemTable,
  moduleTable,
  projectTable,
  savedViewTable,
  taskTable,
  userTable,
  workspaceTable,
} from "../../database/schema";
import { effectiveStatusSql } from "../../intake/queries";
import { projectFeatureEnabledCondition } from "../../project/features";
import { notHiddenProject } from "../../project/visibility";
import { visibleViewCondition } from "../../view/visibility";
import { computedScore, taskScore, taskTextMatch } from "../sources";
import { parseTextQuery } from "../text-query";

// Search over the planning features: cycles, modules, saved views and intake
// requests. Each reader keeps to one workspace, skips projects in the trash
// or with the feature off, and leaves out archived rows, so a result is
// always something the caller can open.

type Scope = {
  workspaceId: string;
  projectId?: string;
  query: string;
  limit: number;
  /** Restricted projects the caller may not see (project/visibility.ts). */
  hidden?: readonly string[];
};

export type PlanningSearchResult = {
  id: string;
  type: "cycle" | "module" | "view" | "intake";
  title: string;
  description?: string;
  projectId?: string;
  projectName?: string;
  projectSlug?: string;
  workspaceId: string;
  workspaceName?: string;
  userId?: string;
  userName?: string;
  createdAt: Date;
  relevanceScore: number;
  taskNumber?: number;
  status?: string;
};

// Cycles, modules and views are small per workspace, so their vectors are
// computed at query time rather than stored; intake requests are tasks and
// use the task index.
function nameMatch(name: SQL, description: SQL, query: string) {
  return computedScore(name, description, parseTextQuery(query));
}

export async function searchCycles({
  workspaceId,
  projectId,
  query,
  limit,
  hidden,
}: Scope): Promise<PlanningSearchResult[]> {
  const { match, score: relevance } = nameMatch(
    sql`${cycleTable.name}`,
    sql`${cycleTable.description}`,
    query,
  );
  const rows = await db
    .select({
      id: cycleTable.id,
      name: cycleTable.name,
      description: cycleTable.description,
      projectId: cycleTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      workspaceName: workspaceTable.name,
      userId: cycleTable.ownerId,
      userName: userTable.name,
      createdAt: cycleTable.createdAt,
      relevanceScore: relevance.as("relevanceScore"),
    })
    .from(cycleTable)
    .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .leftJoin(userTable, eq(userTable.id, cycleTable.ownerId))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        projectId ? eq(cycleTable.projectId, projectId) : undefined,
        projectFeatureEnabledCondition("cycles"),
        notHiddenProject(projectTable.id, hidden ?? []),
        isNull(cycleTable.archivedAt),
        match,
      ),
    )
    .orderBy(desc(relevance), desc(cycleTable.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    type: "cycle",
    title: row.name,
    description: row.description || undefined,
    projectId: row.projectId,
    projectName: row.projectName,
    projectSlug: row.projectSlug ?? undefined,
    workspaceId,
    workspaceName: row.workspaceName,
    userId: row.userId ?? undefined,
    userName: row.userName ?? undefined,
    createdAt: row.createdAt,
    relevanceScore: Number(row.relevanceScore),
  }));
}

export async function searchModules({
  workspaceId,
  projectId,
  query,
  limit,
  hidden,
}: Scope): Promise<PlanningSearchResult[]> {
  const { match, score: relevance } = nameMatch(
    sql`${moduleTable.name}`,
    sql`${moduleTable.description}`,
    query,
  );
  const rows = await db
    .select({
      id: moduleTable.id,
      name: moduleTable.name,
      description: moduleTable.description,
      status: moduleTable.status,
      projectId: moduleTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      workspaceName: workspaceTable.name,
      userId: moduleTable.leadId,
      userName: userTable.name,
      createdAt: moduleTable.createdAt,
      relevanceScore: relevance.as("relevanceScore"),
    })
    .from(moduleTable)
    .innerJoin(projectTable, eq(projectTable.id, moduleTable.projectId))
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .leftJoin(userTable, eq(userTable.id, moduleTable.leadId))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        projectId ? eq(moduleTable.projectId, projectId) : undefined,
        projectFeatureEnabledCondition("modules"),
        notHiddenProject(projectTable.id, hidden ?? []),
        isNull(moduleTable.archivedAt),
        match,
      ),
    )
    .orderBy(desc(relevance), desc(moduleTable.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    type: "module",
    title: row.name,
    description: row.description || undefined,
    projectId: row.projectId,
    projectName: row.projectName,
    projectSlug: row.projectSlug ?? undefined,
    workspaceId,
    workspaceName: row.workspaceName,
    userId: row.userId ?? undefined,
    userName: row.userName ?? undefined,
    createdAt: row.createdAt,
    relevanceScore: Number(row.relevanceScore),
    status: row.status,
  }));
}

/**
 * Saved views the caller may open: shared ones and their own private ones.
 * Workspace views (no project) are never feature-gated.
 */
export async function searchViews({
  workspaceId,
  projectId,
  query,
  limit,
  hidden,
  userId,
}: Scope & { userId: string }): Promise<PlanningSearchResult[]> {
  const { match, score: relevance } = nameMatch(
    sql`${savedViewTable.name}`,
    sql`${savedViewTable.description}`,
    query,
  );
  const rows = await db
    .select({
      id: savedViewTable.id,
      name: savedViewTable.name,
      description: savedViewTable.description,
      projectId: savedViewTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      workspaceName: workspaceTable.name,
      userId: savedViewTable.ownerId,
      userName: userTable.name,
      createdAt: savedViewTable.createdAt,
      relevanceScore: relevance.as("relevanceScore"),
    })
    .from(savedViewTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, savedViewTable.workspaceId),
    )
    .leftJoin(projectTable, eq(projectTable.id, savedViewTable.projectId))
    .leftJoin(userTable, eq(userTable.id, savedViewTable.ownerId))
    .where(
      and(
        eq(savedViewTable.workspaceId, workspaceId),
        projectId
          ? eq(savedViewTable.projectId, projectId)
          : or(
              isNull(savedViewTable.projectId),
              projectFeatureEnabledCondition("views"),
            ),
        projectId ? projectFeatureEnabledCondition("views") : undefined,
        // Workspace views have no project and stay.
        notHiddenProject(savedViewTable.projectId, hidden ?? [], {
          nullable: true,
        }),
        visibleViewCondition(userId),
        match,
      ),
    )
    .orderBy(desc(relevance), desc(savedViewTable.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    type: "view",
    title: row.name,
    description: row.description || undefined,
    projectId: row.projectId ?? undefined,
    projectName: row.projectName ?? undefined,
    projectSlug: row.projectSlug ?? undefined,
    workspaceId,
    workspaceName: row.workspaceName,
    userId: row.userId ?? undefined,
    userName: row.userName ?? undefined,
    createdAt: row.createdAt,
    relevanceScore: Number(row.relevanceScore),
  }));
}

/**
 * Intake requests not yet accepted (an accepted one is an ordinary task and
 * shows up as one). `ownOnly` keeps a caller with intake:create but not
 * intake:read to the requests they submitted, as the queue itself does.
 */
export async function searchIntake({
  workspaceId,
  projectId,
  query,
  limit,
  hidden,
  userId,
  ownOnly,
}: Scope & { userId: string; ownOnly: boolean }): Promise<
  PlanningSearchResult[]
> {
  const text = parseTextQuery(query);
  const relevance = taskScore(text);
  const rows = await db
    .select({
      id: intakeItemTable.id,
      title: taskTable.title,
      status: effectiveStatusSql,
      taskNumber: taskTable.number,
      projectId: intakeItemTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      workspaceName: workspaceTable.name,
      userId: intakeItemTable.submittedBy,
      userName: userTable.name,
      createdAt: intakeItemTable.createdAt,
      relevanceScore: relevance.as("relevanceScore"),
    })
    .from(intakeItemTable)
    .innerJoin(taskTable, eq(taskTable.id, intakeItemTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, intakeItemTable.projectId))
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .leftJoin(userTable, eq(userTable.id, intakeItemTable.submittedBy))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        projectId ? eq(intakeItemTable.projectId, projectId) : undefined,
        projectFeatureEnabledCondition("intake"),
        notHiddenProject(projectTable.id, hidden ?? []),
        ne(intakeItemTable.status, "accepted"),
        isNull(taskTable.deletedAt),
        ownOnly ? eq(intakeItemTable.submittedBy, userId) : undefined,
        taskTextMatch(text),
      ),
    )
    .orderBy(desc(relevance), desc(intakeItemTable.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    type: "intake",
    title: row.title,
    projectId: row.projectId,
    projectName: row.projectName,
    projectSlug: row.projectSlug ?? undefined,
    workspaceId,
    workspaceName: row.workspaceName,
    userId: row.userId ?? undefined,
    userName: row.userName ?? undefined,
    createdAt: row.createdAt,
    relevanceScore: Number(row.relevanceScore),
    taskNumber: row.taskNumber ?? undefined,
    status: row.status,
  }));
}
