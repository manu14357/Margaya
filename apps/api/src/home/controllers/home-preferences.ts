import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { homePreferenceTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  DEFAULT_HOME_WIDGETS,
  type HomeWidget,
  listsEveryWidgetOnce,
  normalizeHomeWidgets,
  sameWidgetList,
} from "../widgets";

async function storedPreference(userId: string, workspaceId: string) {
  const [row] = await db
    .select()
    .from(homePreferenceTable)
    .where(
      and(
        eq(homePreferenceTable.userId, userId),
        eq(homePreferenceTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The caller's widget list, or the defaults. Reading never writes. */
export async function getHomePreferences(userId: string, workspaceId: string) {
  const row = await storedPreference(userId, workspaceId);
  return {
    workspaceId,
    widgets: row
      ? normalizeHomeWidgets(row.widgets)
      : [...DEFAULT_HOME_WIDGETS],
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Saves the full ordered list; an unchanged list writes nothing. */
export async function updateHomePreferences(
  userId: string,
  workspaceId: string,
  widgets: HomeWidget[],
) {
  if (!listsEveryWidgetOnce(widgets)) {
    throw new HTTPException(400, {
      message: "List every home widget exactly once",
    });
  }
  const next = widgets.map(({ key, enabled }) => ({ key, enabled }));

  const current = await storedPreference(userId, workspaceId);
  if (current && sameWidgetList(normalizeHomeWidgets(current.widgets), next)) {
    return { workspaceId, widgets: next, updatedAt: current.updatedAt };
  }

  const [saved] = await db
    .insert(homePreferenceTable)
    .values({ userId, workspaceId, widgets: next })
    .onConflictDoUpdate({
      target: [homePreferenceTable.userId, homePreferenceTable.workspaceId],
      set: { widgets: next, updatedAt: new Date() },
    })
    .returning();
  if (!saved) {
    throw new HTTPException(500, { message: "Failed to save preferences" });
  }

  await publishEvent("home_preferences.changed", { userId, workspaceId });
  return { workspaceId, widgets: next, updatedAt: saved.updatedAt };
}
