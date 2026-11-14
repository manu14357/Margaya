// Groups and frames. An element's `groupIds` lists the groups it belongs to
// from the outermost to the innermost. Frames hold elements through each
// element's `frameId`; frames never nest.

import { type ElementOptions, updateElement } from "./create.js";
import { BOARD_LIMITS, type BoardElement } from "./elements.js";
import {
  boxContainsBox,
  boxesIntersect,
  elementBounds,
  elementBox,
} from "./geometry.js";
import { newElementId } from "./ids.js";
import { sortByOrder } from "./order.js";

/** Group ids shared, from the outside in, by every element in the list. */
function sharedGroups(elements: readonly BoardElement[]): string[] {
  if (elements.length === 0) return [];
  const shared = [...elements[0].groupIds];
  for (const element of elements) {
    let i = 0;
    while (i < shared.length && element.groupIds[i] === shared[i]) i++;
    shared.length = i;
  }
  return shared;
}

/**
 * Puts the selected live elements into a new group, nested inside the groups
 * they all share already. Returns the changed elements (none for fewer than
 * two elements).
 */
export function groupElements(
  elements: readonly BoardElement[],
  ids: Iterable<string>,
  options?: ElementOptions & { groupId?: string },
): BoardElement[] {
  const wanted = new Set(ids);
  const members = elements.filter(
    (element) => wanted.has(element.id) && !element.deleted,
  );
  if (members.length < 2) return [];
  const shared = sharedGroups(members);
  const groupId = options?.groupId ?? newElementId();
  return members
    .filter((element) => element.groupIds.length < BOARD_LIMITS.maxGroupDepth)
    .map((element) =>
      updateElement(
        element,
        {
          groupIds: [
            ...shared,
            groupId,
            ...element.groupIds.slice(shared.length),
          ],
        },
        options,
      ),
    );
}

/**
 * Removes, for each selected element, the outermost of its groups whose
 * members are all selected, so ungrouping a nested group peels one level.
 */
export function ungroupElements(
  elements: readonly BoardElement[],
  ids: Iterable<string>,
  options?: ElementOptions,
): BoardElement[] {
  const wanted = new Set(ids);
  const membersOf = new Map<string, BoardElement[]>();
  for (const element of elements) {
    if (element.deleted) continue;
    for (const groupId of element.groupIds) {
      const list = membersOf.get(groupId);
      if (list) list.push(element);
      else membersOf.set(groupId, [element]);
    }
  }
  const fullySelected = (groupId: string) =>
    (membersOf.get(groupId) ?? []).every((member) => wanted.has(member.id));
  const changed: BoardElement[] = [];
  for (const element of elements) {
    if (!wanted.has(element.id) || element.deleted) continue;
    const index = element.groupIds.findIndex(fullySelected);
    if (index < 0) continue;
    changed.push(
      updateElement(
        element,
        { groupIds: element.groupIds.filter((_, i) => i !== index) },
        options,
      ),
    );
  }
  return changed;
}

/**
 * Widens a selection to whole groups. Outside group editing, selecting any
 * member selects its outermost group. While editing inside `editingGroupId`,
 * members of that group select their next group inwards (or just themselves).
 */
export function expandSelectionToGroups(
  elements: readonly BoardElement[],
  ids: Iterable<string>,
  editingGroupId?: string | null,
): string[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const groups = new Set<string>();
  const selected = new Set<string>();
  for (const id of ids) {
    const element = byId.get(id);
    if (!element || element.deleted) continue;
    selected.add(id);
    const editingIndex = editingGroupId
      ? element.groupIds.indexOf(editingGroupId)
      : -1;
    const groupId =
      editingIndex >= 0
        ? element.groupIds[editingIndex + 1]
        : element.groupIds[0];
    if (groupId) groups.add(groupId);
  }
  if (groups.size === 0) return [...selected];
  for (const element of elements) {
    if (element.deleted) continue;
    if (element.groupIds.some((groupId) => groups.has(groupId))) {
      selected.add(element.id);
    }
  }
  return [...selected];
}

/** Live elements inside the frame, bottom first. */
export function frameChildren(
  elements: readonly BoardElement[],
  frameId: string,
): BoardElement[] {
  return sortByOrder(
    elements.filter(
      (element) => !element.deleted && element.frameId === frameId,
    ),
  );
}

/**
 * Updates `frameId` after a move. An element fully inside a frame joins the
 * top-most such frame; one that no longer touches its frame leaves it; one
 * only partly inside its frame stays. When a frame moves, every element is
 * re-checked against it. Returns the changed elements.
 */
export function assignFrames(
  all: readonly BoardElement[],
  movedIds: Iterable<string>,
  options?: ElementOptions,
): BoardElement[] {
  const moved = new Set(movedIds);
  const frames = sortByOrder(
    all.filter((element) => element.type === "frame" && !element.deleted),
  ).reverse();
  const movedFrames = new Set(
    frames.filter((frame) => moved.has(frame.id)).map((frame) => frame.id),
  );
  const frameById = new Map(frames.map((frame) => [frame.id, frame]));
  const changed: BoardElement[] = [];
  for (const element of all) {
    if (element.deleted || element.type === "frame") continue;
    const relevant =
      moved.has(element.id) ||
      (element.frameId !== null && movedFrames.has(element.frameId)) ||
      movedFrames.size > 0;
    if (!relevant) continue;
    const bounds = elementBounds(element);
    const container = frames.find((frame) =>
      boxContainsBox(elementBox(frame), bounds),
    );
    let next: string | null;
    if (container) {
      next = container.id;
    } else {
      const current = element.frameId
        ? frameById.get(element.frameId)
        : undefined;
      next =
        current && boxesIntersect(elementBox(current), bounds)
          ? current.id
          : null;
    }
    // An element moved by a frame keeps any other frame it already had.
    if (!moved.has(element.id) && next !== element.frameId) {
      const isAffected =
        (next !== null && movedFrames.has(next)) ||
        (element.frameId !== null && movedFrames.has(element.frameId));
      if (!isAffected) continue;
    }
    if (next !== element.frameId) {
      changed.push(updateElement(element, { frameId: next }, options));
    }
  }
  return changed;
}
