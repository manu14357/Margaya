import type { CSSProperties } from "react";

/** The number of `--avatar-N` hues in `styles/semantic-colors.css`. */
export const IDENTITY_HUES = 8;

/** FNV-1a: small, fast and stable across sessions and browsers. */
export function identityHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The `--avatar-N` hue (1-based) a seed always maps to. */
export function identityHue(seed: string): number {
  return (identityHash(seed) % IDENTITY_HUES) + 1;
}

/** A stable identity colour for a person or project, as a CSS value. */
export function identityColor(seed: string): string {
  return `var(--avatar-${identityHue(seed)})`;
}

/**
 * A soft tile of the identity colour with legible text on it. The text is the
 * hue pulled toward the foreground, so it stays above 4.5:1 in both themes.
 */
export function identityTileStyle(seed: string): CSSProperties {
  const color = identityColor(seed);
  return {
    backgroundColor: `color-mix(in srgb, ${color} 18%, var(--background))`,
    color: `color-mix(in srgb, ${color} 60%, var(--foreground))`,
  };
}
