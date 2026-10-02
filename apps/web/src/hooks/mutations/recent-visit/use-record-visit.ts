import { useEffect } from "react";
import recordRecentVisit, {
  type RecordRecentVisitRequest,
} from "@/fetchers/recent-visit/record-recent-visit";

export const RECORD_VISIT_THROTTLE_MS = 60_000;

// Per tab: the same entity is recorded at most once a minute.
const lastRecordedAt = new Map<string, number>();

export function resetRecordedVisits() {
  lastRecordedAt.clear();
}

type ArchivableEntity = { archivedAt?: string | Date | null };

/**
 * Whether entities are archived, for `useRecordVisit`: null until each has
 * loaded, then true when any of them (the item or its project) is archived.
 */
export function visitArchiveState(
  ...entities: Array<ArchivableEntity | null | undefined>
): boolean | null {
  if (entities.some((entity) => !entity)) return null;
  return entities.some((entity) => Boolean(entity?.archivedAt));
}

/**
 * Records that the user opened an entity, once per mount and at most once a
 * minute per entity. Fire-and-forget: failures are ignored, never retried.
 *
 * The API refuses archived items (409, its documented contract), and the
 * browser logs every refused request, so callers pass `archived`: true
 * skips the visit, null waits until the caller knows. Omitted, it records.
 */
export function useRecordVisit({
  workspaceId,
  entityType,
  entityId,
  archived,
}: {
  workspaceId: string | undefined;
  entityType: RecordRecentVisitRequest["entityType"];
  entityId: string | undefined;
  archived?: boolean | null;
}) {
  useEffect(() => {
    if (!workspaceId || !entityId) return;
    if (archived === true || archived === null) return;

    const key = `${workspaceId}:${entityType}:${entityId}`;
    const now = Date.now();
    const last = lastRecordedAt.get(key);
    if (last !== undefined && now - last < RECORD_VISIT_THROTTLE_MS) return;
    lastRecordedAt.set(key, now);

    recordRecentVisit({ workspaceId, entityType, entityId }).catch(() => {
      // Archived, deleted or feature-disabled entities are simply not kept.
    });
  }, [workspaceId, entityType, entityId, archived]);
}

export default useRecordVisit;
