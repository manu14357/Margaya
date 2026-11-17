import type { ComponentType } from "react";

/** Props every template illustration (`art/<id>.tsx`) accepts. */
export type TemplateArtProps = { className?: string };

export type TemplateArtComponent = ComponentType<TemplateArtProps>;

/** The eight template accents, `--art-accent-1..8` in styles/template-art.css. */
export type ArtAccent = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * A colour role for one shape.
 * - `accent` / `soft`: the frame's accent, solid or as a soft tint;
 * - `accent-N` / `soft-N`: a specific accent, for a second colour;
 * - `ink`: the dark badge colour; `skeleton` / `strong`: grey UI shapes;
 * - `surface`: the panel white (dark grey in dark mode).
 */
export type ArtTone =
  | "accent"
  | "soft"
  | "ink"
  | "skeleton"
  | "strong"
  | "surface"
  | `accent-${ArtAccent}`
  | `soft-${ArtAccent}`;

export type ArtPoint = readonly [x: number, y: number];
