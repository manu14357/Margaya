// The project feature switches the create flow shows, with the copy the
// project settings page already uses.

export const PROJECT_FEATURES = [
  {
    key: "cycles",
    field: "cyclesEnabled",
    titleKey: "settings:projectFeatures.items.cycles.title",
    descriptionKey: "settings:projectFeatures.items.cycles.description",
  },
  {
    key: "modules",
    field: "modulesEnabled",
    titleKey: "settings:projectFeatures.items.modules.title",
    descriptionKey: "settings:projectFeatures.items.modules.description",
  },
  {
    key: "views",
    field: "viewsEnabled",
    titleKey: "settings:projectFeatures.items.views.title",
    descriptionKey: "settings:projectFeatures.items.views.description",
  },
  {
    key: "pages",
    field: "pagesEnabled",
    titleKey: "settings:projectFeatures.items.pages.title",
    descriptionKey: "settings:projectFeatures.items.pages.description",
  },
  {
    key: "whiteboards",
    field: "whiteboardsEnabled",
    titleKey: "settings:projectFeatures.items.whiteboards.title",
    descriptionKey: "settings:projectFeatures.items.whiteboards.description",
  },
  {
    key: "intake",
    field: "intakeEnabled",
    titleKey: "settings:projectFeatures.items.intake.title",
    descriptionKey: "settings:projectFeatures.items.intake.description",
  },
  {
    key: "estimates",
    field: "estimatesEnabled",
    titleKey: "settings:projectFeatures.items.estimates.title",
    descriptionKey: "settings:projectFeatures.items.estimates.description",
  },
  {
    key: "timeTracking",
    field: "timeTrackingEnabled",
    titleKey: "settings:projectFeatures.items.timeTracking.title",
    descriptionKey: "settings:projectFeatures.items.timeTracking.description",
  },
  {
    key: "updates",
    field: "updatesEnabled",
    titleKey: "settings:projectFeatures.items.updates.title",
    descriptionKey: "settings:projectFeatures.items.updates.description",
  },
  {
    key: "ai",
    field: "aiEnabled",
    titleKey: "settings:projectFeatures.items.ai.title",
    descriptionKey: "settings:projectFeatures.items.ai.description",
  },
] as const;

export type ProjectFeatureKey = (typeof PROJECT_FEATURES)[number]["key"];
export type FeatureSet = Partial<Record<ProjectFeatureKey, boolean>>;

/** What a project without a template or source starts with (the API default). */
export const DEFAULT_PROJECT_FEATURES: Record<ProjectFeatureKey, boolean> = {
  cycles: true,
  modules: true,
  views: true,
  pages: true,
  whiteboards: true,
  intake: false,
  estimates: false,
  timeTracking: true,
  updates: false,
  ai: true,
};

/** A source project's switches, read from its `*Enabled` fields. */
export function featuresOfProject(
  project: Partial<Record<(typeof PROJECT_FEATURES)[number]["field"], boolean>>,
): Record<ProjectFeatureKey, boolean> {
  const out = { ...DEFAULT_PROJECT_FEATURES };
  for (const feature of PROJECT_FEATURES) {
    const value = project[feature.field];
    if (typeof value === "boolean") out[feature.key] = value;
  }
  return out;
}

/** A template preview's switches; unknown keys are ignored, missing are off. */
export function featuresOfTemplate(
  features: Record<string, boolean>,
): Record<ProjectFeatureKey, boolean> {
  const out = {} as Record<ProjectFeatureKey, boolean>;
  for (const feature of PROJECT_FEATURES) {
    out[feature.key] = features[feature.key] === true;
  }
  return out;
}
