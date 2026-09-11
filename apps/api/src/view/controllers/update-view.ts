import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { savedViewTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { assertViewContent } from "../content";
import {
  mergeViewDisplay,
  mergeViewDisplayProperties,
  mergeViewFilters,
  readViewDisplay,
  readViewDisplayProperties,
  readViewFilters,
  sameJson,
} from "../normalize";
import type { UpdateViewInput } from "../schema";
import {
  canManageView,
  getViewResponse,
  lockViewRow,
  type SavedViewRecord,
  type ViewCaller,
  viewEventPayload,
  viewScopeOf,
} from "./shared";

export const CHANGE_FORBIDDEN =
  "Only the view's owner or an admin can change it";
export const VIEW_LOCKED = "This view is locked. Unlock it to make changes.";
export const PRIVATE_NEEDS_OWNER = "Only the owner can make a view private";

type ViewChanges = Partial<
  Pick<
    SavedViewRecord,
    | "name"
    | "description"
    | "filters"
    | "display"
    | "displayProperties"
    | "access"
  >
>;

/**
 * Changes a view for its owner (with view:update) or an admin (view:delete).
 * Filters, display and display properties merge over the stored values. A
 * locked view refuses every change; an update that changes nothing answers
 * the view and publishes nothing.
 */
async function updateView({
  viewId,
  input,
  caller,
}: {
  viewId: string;
  input: UpdateViewInput;
  caller: ViewCaller;
}) {
  const result = await db.transaction(async (tx) => {
    const current = await lockViewRow(tx, viewId, caller.userId);
    if (!canManageView(current, caller)) {
      throw new HTTPException(403, { message: CHANGE_FORBIDDEN });
    }
    if (current.isLocked) {
      throw new HTTPException(409, { message: VIEW_LOCKED });
    }
    if (
      input.access === "private" &&
      current.access !== "private" &&
      current.ownerId !== caller.userId
    ) {
      throw new HTTPException(403, { message: PRIVATE_NEEDS_OWNER });
    }

    const scope = viewScopeOf(current);
    const stored = {
      filters: readViewFilters(current.filters),
      display: readViewDisplay(current.display, scope),
      displayProperties: readViewDisplayProperties(current.displayProperties),
    };
    const filters = input.filters
      ? mergeViewFilters(stored.filters, input.filters)
      : undefined;
    const display = input.display
      ? mergeViewDisplay(stored.display, input.display)
      : undefined;
    const displayProperties = input.displayProperties
      ? mergeViewDisplayProperties(
          stored.displayProperties,
          input.displayProperties,
        )
      : undefined;
    await assertViewContent(
      {
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        userId: caller.userId,
      },
      { filters, display, displayProperties },
    );

    const set: ViewChanges = {};
    if (input.name !== undefined && input.name !== current.name) {
      set.name = input.name;
    }
    if (
      input.description !== undefined &&
      input.description !== current.description
    ) {
      set.description = input.description;
    }
    if (filters && !sameJson(filters, stored.filters)) set.filters = filters;
    if (display && !sameJson(display, stored.display)) set.display = display;
    if (
      displayProperties &&
      !sameJson(displayProperties, stored.displayProperties)
    ) {
      set.displayProperties = displayProperties;
    }
    if (input.access !== undefined && input.access !== current.access) {
      set.access = input.access;
    }

    const changes = Object.keys(set);
    if (changes.length === 0) return { view: current, changes };
    const [updated] = await tx
      .update(savedViewTable)
      .set(set)
      .where(eq(savedViewTable.id, viewId))
      .returning();
    return { view: updated ?? current, changes };
  });

  if (result.changes.length > 0) {
    await publishEvent("view.updated", {
      ...viewEventPayload(result.view, caller.userId),
      changes: result.changes,
    });
  }
  return getViewResponse(viewId, caller);
}

export default updateView;
