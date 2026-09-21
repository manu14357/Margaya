import type {
  ProjectPublication,
  PublicationLayout,
  PublicationSettingsPatch,
} from "@/types/publication";

// Publish settings rules the UI mirrors from the server (B12 §3.3).

export const PUBLICATION_LAYOUTS: readonly PublicationLayout[] = [
  "board",
  "list",
];

/**
 * The patch for checking or unchecking one layout, or null when nothing
 * changes (already checked, or it is the last layout left).
 */
export function layoutPatch(
  layouts: readonly PublicationLayout[],
  layout: PublicationLayout,
  checked: boolean,
): PublicationSettingsPatch | null {
  const has = layouts.includes(layout);
  if (checked === has) return null;
  if (!checked && layouts.length <= 1) return null;
  const next = PUBLICATION_LAYOUTS.filter((entry) =>
    entry === layout ? checked : layouts.includes(entry),
  );
  return { layouts: [...next] };
}

/** The publication after a settings patch, as the server will store it. */
export function applyPublicationPatch(
  publication: ProjectPublication,
  patch: PublicationSettingsPatch,
): ProjectPublication {
  const next = { ...publication, ...patch } as ProjectPublication;
  if (!next.layouts.includes(next.defaultLayout)) {
    next.defaultLayout = next.layouts[0] ?? "board";
  }
  return next;
}

/** The full public URL for a publication's path (null before it has one). */
export function publicBoardUrl(
  path: string | null | undefined,
  origin: string,
): string {
  return path ? `${origin}${path}` : "";
}

/** Published with comments on: app comments may be made public. */
export function publicCommentsOpen(
  publication: Pick<ProjectPublication, "published" | "commentsEnabled"> | null,
): boolean {
  return Boolean(publication?.published && publication.commentsEnabled);
}
