import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { AiProvenance } from "../ai/provenance-types";
import db from "../database";
import {
  assetTable,
  columnTable,
  customFieldDefinitionTable,
  cycleTable,
  estimatePointTable,
  estimateTable,
  labelTable,
  moduleTable,
  pageCommentTable,
  pageTable,
  projectMemberTable,
  projectTable,
  taskTable,
  teamMemberTable,
  teamTable,
  userTable,
  workspaceRoleTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import { inTriageColumnSql } from "../task/scope";
import { loadUsers } from "../task-export/related";
import { textArray } from "../task-query/context";

// What a whole-workspace export reads beyond tasks. Every query names its
// columns: a column added to one of these tables stays out of the archive until
// someone decides it belongs there, so a new secret can't leak by default.

const PAGE_BATCH = 100;

/** The workspace's settings, members, teams, roles and labels. */
export async function loadWorkspaceDocument(workspaceId: string) {
  const [workspace] = await db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      slug: workspaceTable.slug,
      description: workspaceTable.description,
      logo: workspaceTable.logo,
      timezone: workspaceTable.timezone,
      allowPublicPages: workspaceTable.allowPublicPages,
      allowA2a: workspaceTable.allowA2a,
      createdAt: workspaceTable.createdAt,
    })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  if (!workspace) return null;

  const [members, teams, teamMembers, roles, labels] = await Promise.all([
    db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        role: workspaceUserTable.role,
        joinedAt: workspaceUserTable.joinedAt,
      })
      .from(workspaceUserTable)
      .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
      .where(eq(workspaceUserTable.workspaceId, workspaceId))
      .orderBy(asc(workspaceUserTable.joinedAt), asc(userTable.id)),
    db
      .select({
        id: teamTable.id,
        name: teamTable.name,
        createdAt: teamTable.createdAt,
      })
      .from(teamTable)
      .where(eq(teamTable.workspaceId, workspaceId))
      .orderBy(asc(teamTable.name), asc(teamTable.id)),
    db
      .select({
        teamId: teamMemberTable.teamId,
        userId: teamMemberTable.userId,
      })
      .from(teamMemberTable)
      .innerJoin(teamTable, eq(teamTable.id, teamMemberTable.teamId))
      .where(eq(teamTable.workspaceId, workspaceId)),
    db
      .select({
        role: workspaceRoleTable.role,
        permission: workspaceRoleTable.permission,
      })
      .from(workspaceRoleTable)
      .where(eq(workspaceRoleTable.workspaceId, workspaceId))
      .orderBy(asc(workspaceRoleTable.role)),
    db
      .select({ name: labelTable.name, color: labelTable.color })
      .from(labelTable)
      .where(
        and(eq(labelTable.workspaceId, workspaceId), isNull(labelTable.taskId)),
      )
      .orderBy(asc(labelTable.name)),
  ]);

  return {
    workspace,
    members,
    teams: teams.map((team) => ({
      ...team,
      memberIds: teamMembers
        .filter((member) => member.teamId === team.id)
        .map((member) => member.userId),
    })),
    roles: roles.map((row) => ({
      role: row.role,
      permissions: parsePermissions(row.permission),
    })),
    labels,
  };
}

function parsePermissions(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** One project's settings and the planning objects its tasks point to. */
export async function loadProjectDocument(projectId: string) {
  const [project] = await db
    .select({
      id: projectTable.id,
      slug: projectTable.slug,
      name: projectTable.name,
      icon: projectTable.icon,
      description: projectTable.description,
      visibility: projectTable.visibility,
      position: projectTable.position,
      archivedAt: projectTable.archivedAt,
      createdAt: projectTable.createdAt,
      leadUserId: projectTable.leadUserId,
      defaultAssigneeUserId: projectTable.defaultAssigneeUserId,
      cyclesEnabled: projectTable.cyclesEnabled,
      modulesEnabled: projectTable.modulesEnabled,
      viewsEnabled: projectTable.viewsEnabled,
      pagesEnabled: projectTable.pagesEnabled,
      intakeEnabled: projectTable.intakeEnabled,
      estimatesEnabled: projectTable.estimatesEnabled,
      timeTrackingEnabled: projectTable.timeTrackingEnabled,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project) return null;

  const [columns, members, customFields, cycles, modules, estimates, points] =
    await Promise.all([
      db
        .select({
          id: columnTable.id,
          name: columnTable.name,
          slug: columnTable.slug,
          position: columnTable.position,
          icon: columnTable.icon,
          color: columnTable.color,
          group: columnTable.group,
        })
        .from(columnTable)
        .where(eq(columnTable.projectId, projectId))
        .orderBy(asc(columnTable.position), asc(columnTable.id)),
      db
        .select({
          userId: projectMemberTable.userId,
          role: projectMemberTable.role,
        })
        .from(projectMemberTable)
        .where(eq(projectMemberTable.projectId, projectId))
        .orderBy(asc(projectMemberTable.userId)),
      db
        .select({
          id: customFieldDefinitionTable.id,
          name: customFieldDefinitionTable.name,
          type: customFieldDefinitionTable.type,
          required: customFieldDefinitionTable.required,
          defaultValue: customFieldDefinitionTable.defaultValue,
          options: customFieldDefinitionTable.options,
          position: customFieldDefinitionTable.position,
        })
        .from(customFieldDefinitionTable)
        .where(eq(customFieldDefinitionTable.projectId, projectId))
        .orderBy(
          asc(customFieldDefinitionTable.position),
          asc(customFieldDefinitionTable.id),
        ),
      db
        .select({
          id: cycleTable.id,
          name: cycleTable.name,
          description: cycleTable.description,
          startDate: cycleTable.startDate,
          endDate: cycleTable.endDate,
          ownerId: cycleTable.ownerId,
          archivedAt: cycleTable.archivedAt,
        })
        .from(cycleTable)
        .where(eq(cycleTable.projectId, projectId))
        .orderBy(asc(cycleTable.sortOrder), asc(cycleTable.id)),
      db
        .select({
          id: moduleTable.id,
          name: moduleTable.name,
          description: moduleTable.description,
          status: moduleTable.status,
          startDate: moduleTable.startDate,
          targetDate: moduleTable.targetDate,
          leadId: moduleTable.leadId,
          archivedAt: moduleTable.archivedAt,
        })
        .from(moduleTable)
        .where(eq(moduleTable.projectId, projectId))
        .orderBy(asc(moduleTable.position), asc(moduleTable.id)),
      db
        .select({
          id: estimateTable.id,
          name: estimateTable.name,
          type: estimateTable.type,
          isActive: estimateTable.isActive,
        })
        .from(estimateTable)
        .where(eq(estimateTable.projectId, projectId))
        .orderBy(asc(estimateTable.name)),
      db
        .select({
          estimateId: estimatePointTable.estimateId,
          value: estimatePointTable.value,
          position: estimatePointTable.position,
        })
        .from(estimatePointTable)
        .innerJoin(
          estimateTable,
          eq(estimateTable.id, estimatePointTable.estimateId),
        )
        .where(eq(estimateTable.projectId, projectId))
        .orderBy(asc(estimatePointTable.position)),
    ]);

  return {
    project,
    columns,
    members,
    customFields,
    cycles,
    modules,
    estimates: estimates.map((estimate) => ({
      ...estimate,
      points: points
        .filter((point) => point.estimateId === estimate.id)
        .map(({ value, position }) => ({ value, position })),
    })),
  };
}

/** Pages managers may see (rules.ts): public ones, and ownerless private ones. */
const managerVisiblePage = or(
  eq(pageTable.access, "public"),
  isNull(pageTable.ownerId),
);

/** A page of the workspace itself or of one of the exported projects. */
function pageInScope(projectIds: readonly string[]) {
  return or(
    isNull(pageTable.projectId),
    sql`${pageTable.projectId} = any(${textArray(projectIds)})`,
  );
}

/** Private pages left out of the archive, for the manifest. */
export async function countPrivatePages(workspaceId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(pageTable)
    .where(
      and(
        eq(pageTable.workspaceId, workspaceId),
        isNull(pageTable.deletedAt),
        eq(pageTable.access, "private"),
        isNotNull(pageTable.ownerId),
      ),
    );
  return row?.count ?? 0;
}

/** The exported pages, a batch at a time, each with its comments. */
export async function* exportPageBatches(
  workspaceId: string,
  projectIds: readonly string[],
) {
  let after: string | null = null;
  for (;;) {
    const rows: {
      id: string;
      projectId: string | null;
      parentId: string | null;
      position: number;
      title: string;
      logoKind: string | null;
      logoValue: string | null;
      isLocked: boolean;
      isFullWidth: boolean;
      archivedAt: Date | null;
      publishedAt: Date | null;
      ownerId: string | null;
      createdById: string | null;
      updatedById: string | null;
      createdAt: Date;
      updatedAt: Date;
      markdown: string;
      aiProvenance: AiProvenance | null;
    }[] = await db
      .select({
        id: pageTable.id,
        projectId: pageTable.projectId,
        parentId: pageTable.parentId,
        position: pageTable.position,
        title: pageTable.title,
        logoKind: pageTable.logoKind,
        logoValue: pageTable.logoValue,
        isLocked: pageTable.isLocked,
        isFullWidth: pageTable.isFullWidth,
        archivedAt: pageTable.archivedAt,
        publishedAt: pageTable.publishedAt,
        ownerId: pageTable.ownerId,
        createdById: pageTable.createdById,
        updatedById: pageTable.updatedById,
        createdAt: pageTable.createdAt,
        updatedAt: pageTable.updatedAt,
        markdown: pageTable.contentMarkdown,
        aiProvenance: pageTable.aiProvenance,
      })
      .from(pageTable)
      .where(
        and(
          eq(pageTable.workspaceId, workspaceId),
          isNull(pageTable.deletedAt),
          managerVisiblePage,
          pageInScope(projectIds),
          after ? gt(pageTable.id, after) : undefined,
        ),
      )
      .orderBy(asc(pageTable.id))
      .limit(PAGE_BATCH);
    if (rows.length === 0) return;

    const pageIds = rows.map((row) => row.id);
    const comments = await db
      .select({
        id: pageCommentTable.id,
        pageId: pageCommentTable.pageId,
        userId: pageCommentTable.userId,
        content: pageCommentTable.content,
        createdAt: pageCommentTable.createdAt,
        updatedAt: pageCommentTable.updatedAt,
      })
      .from(pageCommentTable)
      .where(sql`${pageCommentTable.pageId} = any(${textArray(pageIds)})`)
      .orderBy(asc(pageCommentTable.createdAt), asc(pageCommentTable.id));
    const users = await loadUsers(
      [
        ...rows.flatMap((row) => [
          row.ownerId,
          row.createdById,
          row.updatedById,
        ]),
        ...comments.map((comment) => comment.userId),
      ].filter((id): id is string => id !== null),
    );
    const person = (id: string | null) => {
      const user = id ? users.get(id) : undefined;
      return user ? { id: user.id, name: user.name } : null;
    };

    yield rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      parentId: row.parentId,
      position: row.position,
      title: row.title,
      logo:
        row.logoKind && row.logoValue
          ? { kind: row.logoKind, value: row.logoValue }
          : null,
      isLocked: row.isLocked,
      isFullWidth: row.isFullWidth,
      archivedAt: row.archivedAt,
      publishedAt: row.publishedAt,
      owner: person(row.ownerId),
      createdBy: person(row.createdById),
      updatedBy: person(row.updatedById),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      markdown: row.markdown,
      // Null unless AI wrote content on the page (EU AI Act Article 50).
      aiProvenance: row.aiProvenance,
      comments: comments
        .filter((comment) => comment.pageId === row.id)
        .map((comment) => ({
          id: comment.id,
          author: person(comment.userId),
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          text: comment.content,
        })),
    }));

    if (rows.length < PAGE_BATCH) return;
    after = rows[rows.length - 1]?.id ?? null;
  }
}

export type ExportAsset = Awaited<ReturnType<typeof loadExportAssets>>[number];

/**
 * The stored files of what the archive holds: those of live tasks and of
 * exported pages. Files of trashed tasks, triage requests and private pages
 * stay out with what they belong to, as do files nothing points to.
 */
export async function loadExportAssets(
  workspaceId: string,
  projectIds: readonly string[],
) {
  if (projectIds.length === 0) return [];
  return db
    .select({
      id: assetTable.id,
      projectId: assetTable.projectId,
      taskId: assetTable.taskId,
      pageId: assetTable.pageId,
      objectKey: assetTable.objectKey,
      filename: assetTable.filename,
      mimeType: assetTable.mimeType,
      size: assetTable.size,
      kind: assetTable.kind,
      surface: assetTable.surface,
      createdBy: assetTable.createdBy,
      createdAt: assetTable.createdAt,
    })
    .from(assetTable)
    .leftJoin(taskTable, eq(taskTable.id, assetTable.taskId))
    .leftJoin(pageTable, eq(pageTable.id, assetTable.pageId))
    .where(
      and(
        eq(assetTable.workspaceId, workspaceId),
        sql`${assetTable.projectId} = any(${textArray(projectIds)})`,
        or(
          and(
            isNotNull(assetTable.taskId),
            isNull(taskTable.deletedAt),
            sql`not ${inTriageColumnSql}`,
          ),
          and(
            isNotNull(assetTable.pageId),
            isNull(pageTable.deletedAt),
            managerVisiblePage,
          ),
        ),
      ),
    )
    .orderBy(asc(assetTable.createdAt), asc(assetTable.id));
}
