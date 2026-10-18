import { eq } from "drizzle-orm";
import db from "../../database";
import {
  columnTable,
  projectAutomationTable,
  userTable,
} from "../../database/schema";
import {
  type AutomationSettings,
  autoCloseState,
  DEFAULT_AUTOMATION_SETTINGS,
} from "../settings";

type AutomationRow = typeof projectAutomationTable.$inferSelect;

export function settingsOf(row: AutomationRow | null): AutomationSettings {
  if (!row) return { ...DEFAULT_AUTOMATION_SETTINGS };
  return {
    autoArchiveEnabled: row.autoArchiveEnabled,
    autoArchiveMonths: row.autoArchiveMonths,
    autoCloseEnabled: row.autoCloseEnabled,
    autoCloseMonths: row.autoCloseMonths,
    autoCloseColumnId: row.autoCloseColumnId,
    cycleRolloverEnabled: row.cycleRolloverEnabled,
    flowAlertsEnabled: row.flowAlertsEnabled,
  };
}

export async function loadAutomationRow(projectId: string) {
  const [row] = await db
    .select()
    .from(projectAutomationTable)
    .where(eq(projectAutomationTable.projectId, projectId))
    .limit(1);
  return row ?? null;
}

/** The project's automations; defaults (both off) when no row exists. */
export async function getProjectAutomations(projectId: string) {
  const [found] = await db
    .select({
      row: projectAutomationTable,
      column: {
        id: columnTable.id,
        name: columnTable.name,
        slug: columnTable.slug,
        icon: columnTable.icon,
        group: columnTable.group,
        projectId: columnTable.projectId,
      },
      editor: { id: userTable.id, name: userTable.name },
    })
    .from(projectAutomationTable)
    .leftJoin(
      columnTable,
      eq(columnTable.id, projectAutomationTable.autoCloseColumnId),
    )
    .leftJoin(userTable, eq(userTable.id, projectAutomationTable.updatedBy))
    .where(eq(projectAutomationTable.projectId, projectId))
    .limit(1);

  const row = found?.row ?? null;
  const settings = settingsOf(row);
  // A column of another project never counts (the API never stores one).
  const column =
    found?.column && found.column.projectId === projectId
      ? {
          id: found.column.id,
          name: found.column.name,
          slug: found.column.slug,
          icon: found.column.icon,
          group: found.column.group,
        }
      : null;
  const { state, pausedReason } = autoCloseState(settings, column);

  return {
    projectId,
    autoArchive: {
      enabled: settings.autoArchiveEnabled,
      months: settings.autoArchiveMonths,
      lastArchivedAt: row?.lastArchivedAt ?? null,
      lastArchivedCount: row?.lastArchivedCount ?? 0,
    },
    autoClose: {
      enabled: settings.autoCloseEnabled,
      months: settings.autoCloseMonths,
      columnId: settings.autoCloseColumnId,
      column,
      state,
      pausedReason,
      lastClosedAt: row?.lastClosedAt ?? null,
      lastClosedCount: row?.lastClosedCount ?? 0,
    },
    cycleRollover: {
      enabled: settings.cycleRolloverEnabled,
      since: row?.cycleRolloverSince ?? null,
      lastRolledOverAt: row?.lastRolledOverAt ?? null,
      lastRolledOverCount: row?.lastRolledOverCount ?? 0,
    },
    flowAlerts: {
      enabled: settings.flowAlertsEnabled,
      lastCheckedOn: row?.flowAlertsCheckedOn ?? null,
      lastAlertAt: row?.lastFlowAlertAt ?? null,
    },
    lastCheckedAt: row?.lastCheckedAt ?? null,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: found?.editor?.id
      ? { id: found.editor.id, name: found.editor.name }
      : null,
  };
}
