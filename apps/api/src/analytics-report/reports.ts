import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  analyticsReportTable,
  projectTable,
  userTable,
} from "../database/schema";
import { hiddenProjectIds, notHiddenProject } from "../project/visibility";
import {
  MAX_REPORTS_PER_OWNER,
  type ReportConfig,
  reportConfigSchema,
} from "./schema";

// Saved analytics reports. Private reports exist only for their owner
// (404 for everyone else, admins included); workspace reports are readable
// by anyone with analytics access. Only the owner edits a report; a
// workspace report can also be deleted by someone who manages the
// workspace's settings.

export const REPORT_NOT_FOUND = "Report not found";

type ReportRow = typeof analyticsReportTable.$inferSelect;

export type ReportViewer = {
  userId: string;
  /** workspace:manage_settings, which may delete shared reports. */
  canManage: boolean;
};

/** Reports `userId` may see: shared ones, and private ones they own. */
export function visibleReportCondition(userId: string): SQL {
  return or(
    eq(analyticsReportTable.visibility, "workspace"),
    and(
      eq(analyticsReportTable.visibility, "private"),
      eq(analyticsReportTable.ownerId, userId),
    ),
  ) as SQL;
}

/** The report's workspace, or null when it is unknown or not visible. */
export async function visibleReportScope(id: string, userId: string) {
  const [row] = await db
    .select({ workspaceId: analyticsReportTable.workspaceId })
    .from(analyticsReportTable)
    .where(and(eq(analyticsReportTable.id, id), visibleReportCondition(userId)))
    .limit(1);
  return row ?? null;
}

/** A stored config that no longer parses (an older shape) reads as empty. */
function parseConfig(raw: unknown): ReportConfig {
  const parsed = reportConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : { xAxis: "priority" };
}

/**
 * Drops scope projects that are gone, trashed or in another workspace, so a
 * report never names a project the viewer can't reach. With none left the
 * scope falls back to the whole workspace.
 */
async function liveScope(
  workspaceId: string,
  configs: readonly ReportConfig[],
  /** Restricted projects the viewer may not see: dropped too. */
  hidden: readonly string[] = [],
): Promise<Set<string>> {
  const ids = [
    ...new Set(configs.flatMap((config) => config.scope?.projectIds ?? [])),
  ];
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        inArray(projectTable.id, ids),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
        notHiddenProject(projectTable.id, hidden),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

async function toResponses(
  rows: { report: ReportRow; ownerName: string | null }[],
  viewer: ReportViewer,
) {
  if (rows.length === 0) return [];
  const workspaceId = rows[0]?.report.workspaceId ?? "";
  const configs = rows.map((row) => parseConfig(row.report.config));
  const hidden = await hiddenProjectIds(viewer.userId, workspaceId);
  const live = await liveScope(workspaceId, configs, hidden);

  return rows.map(({ report, ownerName }, index) => {
    const config = configs[index] ?? parseConfig(null);
    // Hidden projects are dropped without being counted, so the count does
    // not reveal them.
    const requested = (config.scope?.projectIds ?? []).filter(
      (id) => !hidden.includes(id),
    );
    const kept = requested.filter((id) => live.has(id));
    const { scope: _scope, ...rest } = config;
    const isOwner = report.ownerId === viewer.userId;
    return {
      id: report.id,
      workspaceId: report.workspaceId,
      name: report.name,
      visibility: report.visibility,
      owner:
        report.ownerId && ownerName !== null
          ? { id: report.ownerId, name: ownerName }
          : null,
      isOwner,
      canDelete:
        isOwner || (report.visibility === "workspace" && viewer.canManage),
      config: kept.length > 0 ? { ...rest, scope: { projectIds: kept } } : rest,
      droppedProjectCount: requested.length - kept.length,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  });
}

async function selectReports(where: SQL, viewer: ReportViewer) {
  const rows = await db
    .select({ report: analyticsReportTable, ownerName: userTable.name })
    .from(analyticsReportTable)
    .leftJoin(userTable, eq(userTable.id, analyticsReportTable.ownerId))
    .where(where)
    .orderBy(
      sql`lower(${analyticsReportTable.name})`,
      desc(analyticsReportTable.createdAt),
      asc(analyticsReportTable.id),
    )
    .limit(500);
  return toResponses(rows, viewer);
}

export async function listReports(workspaceId: string, viewer: ReportViewer) {
  return selectReports(
    and(
      eq(analyticsReportTable.workspaceId, workspaceId),
      visibleReportCondition(viewer.userId),
    ) as SQL,
    viewer,
  );
}

export async function getReport(id: string, viewer: ReportViewer) {
  const [report] = await selectReports(
    and(
      eq(analyticsReportTable.id, id),
      visibleReportCondition(viewer.userId),
    ) as SQL,
    viewer,
  );
  if (!report) throw new HTTPException(404, { message: REPORT_NOT_FOUND });
  return report;
}

/** Every scope project must be a live project of the workspace. */
async function assertScope(
  workspaceId: string,
  config: ReportConfig,
  userId: string,
) {
  const requested = [...new Set(config.scope?.projectIds ?? [])];
  if (requested.length === 0) return;
  const live = await liveScope(
    workspaceId,
    [config],
    await hiddenProjectIds(userId, workspaceId),
  );
  if (requested.some((id) => !live.has(id))) {
    throw new HTTPException(404, {
      message: "A project id is not in the workspace",
    });
  }
}

export async function createReport(
  input: {
    workspaceId: string;
    name: string;
    visibility?: "private" | "workspace";
    config: ReportConfig;
  },
  viewer: ReportViewer,
) {
  await assertScope(input.workspaceId, input.config, viewer.userId);
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(analyticsReportTable)
    .where(
      and(
        eq(analyticsReportTable.workspaceId, input.workspaceId),
        eq(analyticsReportTable.ownerId, viewer.userId),
      ),
    );
  if (count >= MAX_REPORTS_PER_OWNER) {
    throw new HTTPException(400, {
      message: `You can save at most ${MAX_REPORTS_PER_OWNER} reports in a workspace`,
    });
  }
  const [created] = await db
    .insert(analyticsReportTable)
    .values({
      workspaceId: input.workspaceId,
      ownerId: viewer.userId,
      name: input.name,
      visibility: input.visibility ?? "private",
      config: input.config,
    })
    .returning({ id: analyticsReportTable.id });
  if (!created) throw new HTTPException(500, { message: "Save failed" });
  return getReport(created.id, viewer);
}

async function loadOwned(id: string, viewer: ReportViewer) {
  const [row] = await db
    .select()
    .from(analyticsReportTable)
    .where(
      and(
        eq(analyticsReportTable.id, id),
        visibleReportCondition(viewer.userId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: REPORT_NOT_FOUND });
  return row;
}

export async function updateReport(
  id: string,
  patch: {
    name?: string;
    visibility?: "private" | "workspace";
    config?: ReportConfig;
  },
  viewer: ReportViewer,
) {
  const row = await loadOwned(id, viewer);
  if (row.ownerId !== viewer.userId) {
    throw new HTTPException(403, {
      message: "Only the report's owner can change it",
    });
  }
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new HTTPException(400, {
      message: "Provide at least one field to change",
    });
  }
  if (patch.config) {
    await assertScope(row.workspaceId, patch.config, viewer.userId);
  }
  await db
    .update(analyticsReportTable)
    .set(patch)
    .where(eq(analyticsReportTable.id, id));
  return getReport(id, viewer);
}

export async function deleteReport(id: string, viewer: ReportViewer) {
  const row = await loadOwned(id, viewer);
  const allowed =
    row.ownerId === viewer.userId ||
    (row.visibility === "workspace" && viewer.canManage);
  if (!allowed) {
    throw new HTTPException(403, {
      message: "Only the owner or a workspace admin can delete this report",
    });
  }
  await db.delete(analyticsReportTable).where(eq(analyticsReportTable.id, id));
  return { id };
}
