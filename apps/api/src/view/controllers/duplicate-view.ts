import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { savedViewTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { VIEW_NOT_FOUND } from "../access";
import {
  readViewDisplay,
  readViewDisplayProperties,
  readViewFilters,
} from "../normalize";
import { MAX_VIEW_NAME_LENGTH } from "../schema";
import {
  getViewResponse,
  type ViewCaller,
  viewEventPayload,
  viewScopeOf,
} from "./shared";

/**
 * Copies a view the caller can see into a new, unlocked view they own, with
 * the same project, access, filters and display. The copy is not re-checked:
 * it holds exactly what the source holds.
 */
async function duplicateView({
  viewId,
  name,
  caller,
}: {
  viewId: string;
  name?: string;
  caller: ViewCaller;
}) {
  const [source] = await db
    .select()
    .from(savedViewTable)
    .where(eq(savedViewTable.id, viewId))
    .limit(1);
  if (
    !source ||
    (source.access === "private" && source.ownerId !== caller.userId)
  ) {
    throw new HTTPException(404, { message: VIEW_NOT_FOUND });
  }

  const [copy] = await db
    .insert(savedViewTable)
    .values({
      workspaceId: source.workspaceId,
      projectId: source.projectId,
      name: (name ?? `${source.name} (copy)`)
        .slice(0, MAX_VIEW_NAME_LENGTH)
        .trim(),
      description: source.description,
      filters: readViewFilters(source.filters),
      display: readViewDisplay(source.display, viewScopeOf(source)),
      displayProperties: readViewDisplayProperties(source.displayProperties),
      access: source.access,
      ownerId: caller.userId,
    })
    .returning();
  if (!copy) {
    throw new HTTPException(500, { message: "Failed to duplicate the view" });
  }

  await publishEvent("view.created", viewEventPayload(copy, caller.userId));
  return getViewResponse(copy.id, caller);
}

export default duplicateView;
