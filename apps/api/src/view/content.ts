import {
  customFieldIdOfKey,
  isCustomFieldDisplayKey,
} from "../task-query/schema";
import { assertViewReferences } from "./references";
import type { ViewDisplay, ViewDisplayProperties, ViewFilters } from "./types";
import {
  assertViewDisplay,
  assertViewDisplayProperties,
  assertViewFilters,
} from "./validate";

/**
 * Runs every save-time rule on the parts of a view being written: the
 * engine's filter validation, scope rules and strict references. Parts left
 * out are not checked, so a stale reference elsewhere never blocks a rename.
 */
export async function assertViewContent(
  {
    workspaceId,
    projectId,
    userId,
  }: { workspaceId: string; projectId: string | null; userId: string },
  {
    filters,
    display,
    displayProperties,
  }: {
    filters?: ViewFilters;
    display?: ViewDisplay;
    displayProperties?: ViewDisplayProperties;
  },
): Promise<void> {
  const scope = projectId ? "project" : "workspace";
  if (filters) assertViewFilters(filters, { scope, workspaceId, userId });
  if (display) assertViewDisplay(display, scope);
  if (displayProperties) assertViewDisplayProperties(displayProperties, scope);
  await assertViewReferences(
    { workspaceId, projectId },
    {
      root: filters?.root ?? null,
      customFieldColumns: [
        ...(displayProperties?.customFields ?? []),
        // Grouping or sorting by a custom field names one the same way.
        ...[display?.groupBy, display?.subGroupBy, display?.orderBy.field]
          .filter(isCustomFieldDisplayKey)
          .map(customFieldIdOfKey),
      ],
    },
  );
}
