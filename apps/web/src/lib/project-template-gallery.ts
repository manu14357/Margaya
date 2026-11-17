// The template gallery's presentation: category groups and order, featured
// picks, the intent chips of workspace creation, search and the
// "Recommended" list. Template content and category membership come from the
// API catalog; this file only decides how to show them
// (plans/create-flow-and-templates/02-flows/project-creation-story.md §4.3).

/** The catalog's own blank template; the gallery always shows it as tile 1. */
export const BLANK_TEMPLATE_ID = "blank";
/** A learning project, never recommended; offered as a quiet link. */
export const GUIDED_TOUR_TEMPLATE_ID = "sample-playground";

export const RECOMMENDED_CATEGORY = "recommended";
export const ALL_CATEGORY = "all";
export const FROM_WORKSPACE_CATEGORY = "from-workspace";

export type GalleryCategoryId =
  | typeof RECOMMENDED_CATEGORY
  | typeof ALL_CATEGORY
  | typeof FROM_WORKSPACE_CATEGORY
  | (string & {});

export const CATEGORY_GROUPS = [
  {
    id: "product",
    labelKey: "common:modals.createProject.choose.groups.product",
    categories: [
      "software-development",
      "product-management",
      "design",
      "analytics",
      "it",
    ],
  },
  {
    id: "service",
    labelKey: "common:modals.createProject.choose.groups.service",
    categories: [
      "service-management",
      "customer-service",
      "human-resources",
      "finance",
      "legal",
      "facilities",
    ],
  },
  {
    id: "growth",
    labelKey: "common:modals.createProject.choose.groups.growth",
    categories: ["marketing", "sales", "nonprofit"],
  },
  {
    id: "everyday",
    labelKey: "common:modals.createProject.choose.groups.everyday",
    categories: ["work-management", "operations", "personal"],
  },
] as const;

/** At most three picks per category, shown first in this order. */
export const FEATURED_BY_CATEGORY: Record<string, readonly string[]> = {
  "software-development": ["scrum", "kanban", "bug-tracking"],
  "product-management": [
    "product-roadmap",
    "product-discovery",
    "prioritization",
  ],
  design: ["design-request-desk", "ux-design", "marketing-assets"],
  analytics: ["analytics-request-desk"],
  it: ["it-service-desk", "it-operations", "it-asset-management"],
  "service-management": [
    "general-service-desk",
    "it-service-desk",
    "customer-support",
  ],
  "customer-service": ["customer-support", "task-tracking", "kanban"],
  "human-resources": ["hr-service-desk", "recruitment", "employee-reviews"],
  finance: ["financial-close", "budget-planning", "finance-service-desk"],
  legal: ["legal-request-desk", "document-review", "ip-infringement"],
  facilities: ["facilities-service-desk", "it-asset-management"],
  marketing: [
    "content-calendar",
    "campaign-management",
    "marketing-request-desk",
  ],
  sales: ["sales-pipeline", "lead-tracking", "sales-support-desk"],
  nonprofit: ["grant-tracker", "nonprofit-programs", "community-management"],
  "work-management": [
    "project-management",
    "task-tracking",
    "content-calendar",
  ],
  operations: ["process-control", "procurement", "general-service-desk"],
  personal: ["personal-planner", "task-tracking", "project-management"],
};

/** Three different shapes of work, for no intent and no history. */
export const DEFAULT_RECOMMENDED = [
  "kanban",
  "project-management",
  "general-service-desk",
] as const;

export const MAX_RECOMMENDED = 6;

/** "What will you track first?" chips: each maps to one gallery category. */
export const INTENT_CHIPS = [
  {
    id: "team",
    category: "work-management",
    labelKey: "auth:onboarding.intent.team",
  },
  {
    id: "software",
    category: "software-development",
    labelKey: "auth:onboarding.intent.software",
  },
  {
    id: "product",
    category: "product-management",
    labelKey: "auth:onboarding.intent.product",
  },
  {
    id: "marketing",
    category: "marketing",
    labelKey: "auth:onboarding.intent.marketing",
  },
  {
    id: "service",
    category: "service-management",
    labelKey: "auth:onboarding.intent.service",
  },
  { id: "it", category: "it", labelKey: "auth:onboarding.intent.it" },
  {
    id: "hr",
    category: "human-resources",
    labelKey: "auth:onboarding.intent.hr",
  },
  {
    id: "personal",
    category: "personal",
    labelKey: "auth:onboarding.intent.personal",
  },
] as const;

export const MORE_INTENT_CHIPS = [
  { id: "sales", category: "sales", labelKey: "auth:onboarding.intent.sales" },
  {
    id: "support",
    category: "customer-service",
    labelKey: "auth:onboarding.intent.support",
  },
  {
    id: "finance",
    category: "finance",
    labelKey: "auth:onboarding.intent.finance",
  },
  {
    id: "design",
    category: "design",
    labelKey: "auth:onboarding.intent.design",
  },
  {
    id: "operations",
    category: "operations",
    labelKey: "auth:onboarding.intent.operations",
  },
  { id: "legal", category: "legal", labelKey: "auth:onboarding.intent.legal" },
  {
    id: "facilities",
    category: "facilities",
    labelKey: "auth:onboarding.intent.facilities",
  },
  {
    id: "analytics",
    category: "analytics",
    labelKey: "auth:onboarding.intent.analytics",
  },
  {
    id: "nonprofit",
    category: "nonprofit",
    labelKey: "auth:onboarding.intent.nonprofit",
  },
] as const;

/** The parts of a catalog template the gallery reads. */
export type GalleryTemplate = {
  id: string;
  categories: readonly string[];
  featured: boolean;
  name: string;
  pitch: string;
  description?: string;
};

export type GalleryCategory = { id: string; name: string };

/** Lower case without accents, so "cafe" finds "Café". */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

/** Templates shown as tiles: the blank template is always tile 1 instead. */
export function galleryTemplates<T extends GalleryTemplate>(
  templates: readonly T[],
): T[] {
  return templates.filter((template) => template.id !== BLANK_TEMPLATE_ID);
}

/** Categories with at least one template; the rest stay hidden, never empty. */
export function visibleCategories<C extends GalleryCategory>(
  categories: readonly C[],
  templates: readonly GalleryTemplate[],
): C[] {
  const tiles = galleryTemplates(templates);
  return categories.filter((category) =>
    tiles.some((template) => template.categories.includes(category.id)),
  );
}

/** A category's templates: its featured picks first, then catalog order. */
export function templatesInCategory<T extends GalleryTemplate>(
  templates: readonly T[],
  categoryId: string,
): T[] {
  const members = galleryTemplates(templates).filter((template) =>
    template.categories.includes(categoryId),
  );
  const featured = FEATURED_BY_CATEGORY[categoryId] ?? [];
  const rank = (id: string) => {
    const index = featured.indexOf(id);
    return index === -1 ? featured.length : index;
  };
  return members
    .map((template, index) => ({ template, index }))
    .sort(
      (a, b) => rank(a.template.id) - rank(b.template.id) || a.index - b.index,
    )
    .map(({ template }) => template);
}

/**
 * At most six picks: templates of the intent's category, then the last one
 * used, then the defaults and the catalog's featured ones. The guided tour
 * is never recommended.
 */
export function recommendedTemplates<T extends GalleryTemplate>(
  templates: readonly T[],
  {
    intent,
    lastTemplateId,
  }: { intent?: string | null; lastTemplateId?: string | null } = {},
): T[] {
  const pool = galleryTemplates(templates).filter(
    (template) => template.id !== GUIDED_TOUR_TEMPLATE_ID,
  );
  const byId = new Map(pool.map((template) => [template.id, template]));
  const picked: T[] = [];
  const add = (template: T | undefined) => {
    if (!template || picked.includes(template)) return;
    if (picked.length < MAX_RECOMMENDED) picked.push(template);
  };
  if (intent) {
    for (const template of templatesInCategory(pool, intent)) add(template);
  }
  if (lastTemplateId) add(byId.get(lastTemplateId));
  if (!intent && !lastTemplateId) {
    for (const id of DEFAULT_RECOMMENDED) add(byId.get(id));
  }
  for (const template of pool) if (template.featured) add(template);
  for (const id of DEFAULT_RECOMMENDED) add(byId.get(id));
  // A small catalog still fills the row.
  if (picked.length < 3) for (const template of pool) add(template);
  return picked;
}

/** Search across every category: name, pitch, description and category names. */
export function searchTemplates<T extends GalleryTemplate>(
  templates: readonly T[],
  categories: readonly GalleryCategory[],
  query: string,
): T[] {
  const needle = normalizeSearch(query);
  if (!needle) return galleryTemplates(templates);
  const categoryName = new Map(
    categories.map((category) => [category.id, category.name]),
  );
  return galleryTemplates(templates).filter((template) => {
    const haystack = [
      template.name,
      template.pitch,
      template.description ?? "",
      ...template.categories.map((id) => categoryName.get(id) ?? ""),
    ]
      .map(normalizeSearch)
      .join(" ");
    return haystack.includes(needle);
  });
}

/** The project key rule: 1 to 8 letters or digits, any script. */
export function isValidProjectKey(key: string): boolean {
  return /^[\p{L}\p{N}]{1,8}$/u.test(key.trim());
}

export const MAX_PROJECT_NAME = 80;

export function isValidProjectName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_PROJECT_NAME;
}
