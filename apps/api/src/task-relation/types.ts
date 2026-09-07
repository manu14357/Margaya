// Relation vocabulary. One row is stored per relation; inverse names are
// accepted on input and stored flipped, and each task reads a relation from
// its own point of view (the display key). web/lib/task-relations.ts mirrors
// the perspective table.

/** What `task_relation.relation_type` holds (source → target). */
export const STORED_RELATION_TYPES = [
  "subtask", // source is the parent of target
  "blocks", // source blocks target
  "related", // symmetric
  "duplicate", // source is a duplicate of target; shown the same on both sides
  "start_before", // source starts before target
  "finish_before", // source finishes before target
] as const;

export type StoredRelationType = (typeof STORED_RELATION_TYPES)[number];

/** Every name `POST /task-relation` accepts. */
export const RELATION_INPUT_NAMES = [
  "subtask",
  "blocks",
  "blocking",
  "blocked_by",
  "related",
  "duplicate",
  "start_before",
  "start_after",
  "finish_before",
  "finish_after",
] as const;

export type RelationInputName = (typeof RELATION_INPUT_NAMES)[number];

/** Display keys in group order, as a task sees its non-subtask relations. */
export const RELATION_DISPLAY_KEYS = [
  "blocked_by",
  "blocking",
  "related",
  "duplicate",
  "start_before",
  "start_after",
  "finish_before",
  "finish_after",
] as const;

export type RelationDisplayKey = (typeof RELATION_DISPLAY_KEYS)[number];

const INPUTS: Record<
  RelationInputName,
  { type: StoredRelationType; flipped: boolean }
> = {
  subtask: { type: "subtask", flipped: false },
  blocks: { type: "blocks", flipped: false },
  blocking: { type: "blocks", flipped: false },
  blocked_by: { type: "blocks", flipped: true },
  related: { type: "related", flipped: false },
  duplicate: { type: "duplicate", flipped: false },
  start_before: { type: "start_before", flipped: false },
  start_after: { type: "start_before", flipped: true },
  finish_before: { type: "finish_before", flipped: false },
  finish_after: { type: "finish_before", flipped: true },
};

/** Types whose loops are refused: an order between two tasks. */
const DIRECTIONAL_TYPES = new Set<string>([
  "blocks",
  "start_before",
  "finish_before",
]);

export function isDirectionalRelationType(type: string): boolean {
  return DIRECTIONAL_TYPES.has(type);
}

export type StoredRelation = {
  sourceTaskId: string;
  targetTaskId: string;
  relationType: StoredRelationType;
};

/** The row an input name stores: its type, with inverse names flipped. */
export function normalizeRelationInput(input: {
  sourceTaskId: string;
  targetTaskId: string;
  relationType: RelationInputName;
}): StoredRelation {
  const { type, flipped } = INPUTS[input.relationType];
  return flipped
    ? {
        sourceTaskId: input.targetTaskId,
        targetTaskId: input.sourceTaskId,
        relationType: type,
      }
    : {
        sourceTaskId: input.sourceTaskId,
        targetTaskId: input.targetTaskId,
        relationType: type,
      };
}

/**
 * How a stored relation reads from one of its tasks. Symmetric types (and
 * unknown legacy values) read the same from both sides.
 */
export function relationPerspective(
  relationType: string,
  viewerIsSource: boolean,
): string {
  switch (relationType) {
    case "blocks":
      return viewerIsSource ? "blocking" : "blocked_by";
    case "start_before":
      return viewerIsSource ? "start_before" : "start_after";
    case "finish_before":
      return viewerIsSource ? "finish_before" : "finish_after";
    default:
      return relationType;
  }
}
