export const FAVORITES_LIMIT = 100;

/** New favorites go on top: one above the current minimum, or 0. */
export function newFavoritePosition(currentMinimum: number | null): number {
  return currentMinimum === null ? 0 : currentMinimum - 1;
}

/**
 * The final order after a reorder request. Ids the request omits keep the
 * rank they hold, and the requested ids fill the remaining slots in the order
 * given. Callers renumber the result to 0..n-1.
 */
export function mergeRequestedOrder(
  currentOrder: readonly string[],
  requestedOrder: readonly string[],
): string[] {
  const requestedIds = new Set(requestedOrder);
  const requested = requestedOrder[Symbol.iterator]();

  return currentOrder.map((id) =>
    requestedIds.has(id) ? (requested.next().value ?? id) : id,
  );
}
