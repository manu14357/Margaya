import type { ColumnGroup } from "../column/groups";
import { deriveCycleStatus } from "../cycle/dates";
import { entryColumn, PLANNED_STATUS } from "../task/scope";
import type { DraftCustomFieldValue, DraftValues } from "./normalize";
import type { DroppedDraftField } from "./response";

// The pure half of publishing (§3.1.6 steps 6-13): which stored values the
// new task keeps. Soft values that went stale while the draft waited are
// dropped and reported instead of blocking the publish.

/** What the database says about the draft's references right now. */
export type PublishFacts = {
  /** "Today" (UTC) for cycle status. */
  today: string;
  /** The project's columns, triage excluded. */
  columns: readonly { slug: string; position: number; group: ColumnGroup }[];
  /** Which of the draft's assignees may still be assigned. */
  assignableIds: ReadonlySet<string>;
  /** The project's custom field ids. */
  fieldIds: ReadonlySet<string>;
  features: { cycles: boolean; modules: boolean; estimates: boolean };
  /** The draft's cycle when it belongs to the project, else null. */
  cycle: {
    archivedAt: Date | null;
    startDate: string | null;
    endDate: string | null;
  } | null;
  /** The draft's modules that belong to the project and are not archived. */
  activeModuleIds: ReadonlySet<string>;
  /** True when the draft's point belongs to the project's active estimate. */
  pointActive: boolean;
};

export type PublishPlan = {
  status: string;
  assigneeIds: string[];
  customFieldValues: DraftCustomFieldValue[];
  cycleId: string | null;
  moduleIds: string[];
  estimatePointId: string | null;
  dropped: DroppedDraftField[];
};

function resolveStatus(
  status: string | null,
  columns: PublishFacts["columns"],
): { status: string; stale: boolean } {
  if (
    status === PLANNED_STATUS ||
    (status !== null && columns.some((column) => column.slug === status))
  ) {
    return { status, stale: false };
  }
  const entry = entryColumn(columns);
  return {
    status: entry?.slug ?? PLANNED_STATUS,
    stale: status !== null,
  };
}

/** Only draft, upcoming and current cycles that are not archived take tasks. */
function cycleAssignable(cycle: PublishFacts["cycle"], today: string) {
  return (
    cycle !== null &&
    cycle.archivedAt === null &&
    deriveCycleStatus(cycle, today) !== "completed"
  );
}

export function buildPublishPlan(
  draft: DraftValues,
  facts: PublishFacts,
): PublishPlan {
  const dropped: DroppedDraftField[] = [];

  const status = resolveStatus(draft.status, facts.columns);
  if (status.stale) dropped.push("status");

  const assigneeIds = draft.assigneeIds.filter((id) =>
    facts.assignableIds.has(id),
  );
  if (assigneeIds.length !== draft.assigneeIds.length) {
    dropped.push("assignees");
  }

  // Values of deleted fields go quietly: the field itself is gone.
  const customFieldValues = draft.customFieldValues.filter(({ fieldId }) =>
    facts.fieldIds.has(fieldId),
  );

  let cycleId: string | null = null;
  if (draft.cycleId) {
    if (facts.features.cycles && cycleAssignable(facts.cycle, facts.today)) {
      cycleId = draft.cycleId;
    } else {
      dropped.push("cycle");
    }
  }

  const moduleIds = facts.features.modules
    ? draft.moduleIds.filter((id) => facts.activeModuleIds.has(id))
    : [];
  if (moduleIds.length !== draft.moduleIds.length) dropped.push("modules");

  let estimatePointId: string | null = null;
  if (draft.estimatePointId) {
    if (facts.features.estimates && facts.pointActive) {
      estimatePointId = draft.estimatePointId;
    } else {
      dropped.push("estimate");
    }
  }

  return {
    status: status.status,
    assigneeIds,
    customFieldValues,
    cycleId,
    moduleIds,
    estimatePointId,
    dropped,
  };
}
