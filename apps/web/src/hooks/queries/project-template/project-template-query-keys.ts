// Every template query starts with "project-templates", keyed by the locale
// the text is resolved in. The catalog is static per server build (the API
// answers 304 for an unchanged ETag), so the hooks never go stale on their own.
export const projectTemplateQueryKeys = {
  all: () => ["project-templates"] as const,
  catalog: (locale: string) =>
    ["project-templates", "catalog", locale] as const,
  preview: (id: string, locale: string) =>
    ["project-templates", "preview", id, locale] as const,
  starters: (locale: string) =>
    ["project-templates", "starters", locale] as const,
};
