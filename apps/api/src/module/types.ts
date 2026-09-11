// Plain types shared by the module schema, controllers and helpers. Kept free
// of runtime imports so database/schema.ts can reference them.

/** Set by hand; the order is the list's grouping order. */
export const MODULE_STATUSES = [
  "backlog",
  "planned",
  "in-progress",
  "paused",
  "completed",
  "cancelled",
] as const;

export type ModuleStatus = (typeof MODULE_STATUSES)[number];

/** Only modules in these statuses can be archived. */
export const ARCHIVABLE_MODULE_STATUSES: readonly ModuleStatus[] = [
  "completed",
  "cancelled",
];
