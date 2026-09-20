// Pure list logic behind the favorites sidebar and toggles, kept out of the
// hooks so the optimistic updates are easy to test.

export const FAVORITES_LIMIT = 100;

export type FavoriteLike = {
  id: string;
  entityType: string;
  entityId: string;
  position: number;
};

export function findFavorite<T extends FavoriteLike>(
  favorites: readonly T[] | undefined,
  entityType: string,
  entityId: string,
): T | undefined {
  return favorites?.find(
    (favorite) =>
      favorite.entityType === entityType && favorite.entityId === entityId,
  );
}

/** New favorites go on top, one position above the current first. */
export function prependFavorite<T extends FavoriteLike>(
  favorites: readonly T[],
  favorite: T,
): T[] {
  const withoutSameEntity = favorites.filter(
    (candidate) =>
      candidate.entityType !== favorite.entityType ||
      candidate.entityId !== favorite.entityId,
  );
  const top = withoutSameEntity.reduce(
    (min, candidate) => Math.min(min, candidate.position),
    Number.POSITIVE_INFINITY,
  );
  return [
    {
      ...favorite,
      position: Number.isFinite(top) ? top - 1 : 0,
    },
    ...withoutSameEntity,
  ];
}

export function removeFavoriteByEntity<T extends FavoriteLike>(
  favorites: readonly T[],
  entityType: string,
  entityId: string,
): T[] {
  return favorites.filter(
    (favorite) =>
      favorite.entityType !== entityType || favorite.entityId !== entityId,
  );
}

/** Replaces the placeholder for an entity with the server's row. */
export function replaceFavorite<T extends FavoriteLike>(
  favorites: readonly T[],
  saved: T,
): T[] {
  return favorites.map((favorite) =>
    favorite.entityType === saved.entityType &&
    favorite.entityId === saved.entityId
      ? saved
      : favorite,
  );
}

/**
 * Moves the dragged favorite onto the target's place and renumbers every
 * position, so a second drag before the refetch sorts correctly. Returns the
 * list unchanged when either id is unknown or they are the same.
 */
export function moveFavorite<T extends FavoriteLike>(
  favorites: readonly T[],
  activeId: string,
  overId: string,
): T[] {
  const from = favorites.findIndex((favorite) => favorite.id === activeId);
  const to = favorites.findIndex((favorite) => favorite.id === overId);
  if (from === -1 || to === -1 || from === to) return [...favorites];

  const next = [...favorites];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((favorite, position) => ({ ...favorite, position }));
}
