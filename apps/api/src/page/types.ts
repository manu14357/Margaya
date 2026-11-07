// Page vocabulary shared by the schema, validators and controllers.

export const PAGE_ACCESS = ["public", "private"] as const;
export type PageAccess = (typeof PAGE_ACCESS)[number];

export const PAGE_LOGO_KINDS = ["emoji", "icon"] as const;
export type PageLogoKind = (typeof PAGE_LOGO_KINDS)[number];

export const PAGE_REFERENCE_TYPES = ["user", "task", "page"] as const;
export type PageReferenceType = (typeof PAGE_REFERENCE_TYPES)[number];

/** Limits (spec §2.5). */
export const PAGE_LIMITS = {
  titleLength: 255,
  depth: 5,
  pagesPerProject: 5000,
  /** Markdown accepted by REST create and replace. */
  markdownBytes: 1024 * 1024,
  /** The JSON envelope around that markdown. */
  requestBodyBytes: 1.5 * 1024 * 1024,
  /** Encoded Yjs state. */
  yjsStateBytes: 5 * 1024 * 1024,
  versionsPerPage: 20,
  versionCoalesceMs: 10 * 60 * 1000,
  commentLength: 20_000,
} as const;
