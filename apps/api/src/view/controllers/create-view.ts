import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { savedViewTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { assertViewContent } from "../content";
import {
  defaultViewDisplay,
  defaultViewDisplayProperties,
  defaultViewFilters,
  mergeViewDisplay,
  mergeViewDisplayProperties,
  mergeViewFilters,
} from "../normalize";
import type { CreateViewInput } from "../schema";
import {
  getViewResponse,
  type ViewCaller,
  viewEventPayload,
  viewScopeOf,
} from "./shared";

/**
 * Saves a new view owned by the caller. Missing parts get the scope's
 * defaults; everything else must pass the engine's validation and name only
 * rows of the view's workspace (and project).
 */
async function createView({
  input,
  workspaceId,
  projectId,
  caller,
}: {
  input: Omit<CreateViewInput, "workspaceId" | "projectId">;
  workspaceId: string;
  projectId: string | null;
  caller: ViewCaller;
}) {
  const scope = viewScopeOf({ projectId });
  const filters = mergeViewFilters(defaultViewFilters(), input.filters);
  const display = mergeViewDisplay(defaultViewDisplay(scope), input.display);
  const displayProperties = mergeViewDisplayProperties(
    defaultViewDisplayProperties(),
    input.displayProperties,
  );
  await assertViewContent(
    { workspaceId, projectId, userId: caller.userId },
    { filters, display, displayProperties },
  );

  const [view] = await db
    .insert(savedViewTable)
    .values({
      workspaceId,
      projectId,
      name: input.name,
      description: input.description ?? "",
      filters,
      display,
      displayProperties,
      access: input.access ?? "workspace",
      ownerId: caller.userId,
    })
    .returning();
  if (!view) {
    throw new HTTPException(500, { message: "Failed to create the view" });
  }

  await publishEvent("view.created", viewEventPayload(view, caller.userId));
  return getViewResponse(view.id, caller);
}

export default createView;
