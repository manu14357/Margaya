/**
 * Translation namespaces left out of the startup bundle: large, and needed
 * only on a few screens (the public landing, the instance settings, the
 * whiteboard editor) or never in the web app (`projectTemplates` is read by
 * the API). The build splits each `i18n/<locale>.json` into a core part
 * without these and one part per namespace (vite-i18n-split.ts); i18next
 * loads a part the first time something asks for its namespace.
 */
export const LAZY_NAMESPACES = [
  "projectTemplates",
  "landing",
  "instanceAdmin",
  "whiteboardEditor",
] as const;

export type LazyNamespace = (typeof LAZY_NAMESPACES)[number];
