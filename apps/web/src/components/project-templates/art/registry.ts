import type { TemplateArtComponent } from "./types";

type ArtModule = { default: TemplateArtComponent };

// Every `art/<id>.tsx` registers itself by existing: adding a template's art
// needs no edit here. Each one is its own lazy chunk.
const modules = import.meta.glob<ArtModule>([
  "./*.tsx",
  "!./primitives.tsx",
  "!./index.tsx",
  "!./*.test.tsx",
]);

const loaders = new Map(
  Object.entries(modules).map(([path, load]) => [
    path.slice("./".length, -".tsx".length),
    load,
  ]),
);

/** Template ids that have their own illustration, sorted. */
export const templateArtIds: readonly string[] = [...loaders.keys()].sort();

export function hasTemplateArt(id: string): boolean {
  return loaders.has(id);
}

/** Loads one template's art module, or `null` when the id has none. */
export function loadTemplateArt(id: string): Promise<ArtModule> | null {
  return loaders.get(id)?.() ?? null;
}
