import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  FileText,
  Inbox,
  IterationCw,
  Layers,
  Ruler,
  Timer,
} from "lucide-react";
import type { Project } from "@/types/project";

// Per-project feature toggles, mirroring the API's feature flags. A feature
// is `isAvailable` once its slice ships in the web app; until then it stays
// hidden everywhere (settings rows, sections, slots) whatever its flag says.
// The lead flips `isAvailable` when integrating each feature slice.
export const PROJECT_FEATURE_KEYS = [
  "cycles",
  "modules",
  "views",
  "pages",
  "intake",
  "estimates",
  "timeTracking",
] as const;

export type ProjectFeatureKey = (typeof PROJECT_FEATURE_KEYS)[number];

export type ProjectFeatureField =
  | "cyclesEnabled"
  | "modulesEnabled"
  | "viewsEnabled"
  | "pagesEnabled"
  | "intakeEnabled"
  | "estimatesEnabled"
  | "timeTrackingEnabled";

export type ProjectFeatureFlags = Record<ProjectFeatureField, boolean>;

type ProjectFeatureDefinition = {
  key: ProjectFeatureKey;
  field: ProjectFeatureField;
  titleKey: `settings:projectFeatures.items.${ProjectFeatureKey}.title`;
  descriptionKey: `settings:projectFeatures.items.${ProjectFeatureKey}.description`;
  icon: LucideIcon;
  isAvailable: boolean;
};

export const PROJECT_FEATURES: readonly ProjectFeatureDefinition[] = [
  {
    key: "cycles",
    field: "cyclesEnabled",
    titleKey: "settings:projectFeatures.items.cycles.title",
    descriptionKey: "settings:projectFeatures.items.cycles.description",
    icon: IterationCw,
    isAvailable: true,
  },
  {
    key: "modules",
    field: "modulesEnabled",
    titleKey: "settings:projectFeatures.items.modules.title",
    descriptionKey: "settings:projectFeatures.items.modules.description",
    icon: Boxes,
    isAvailable: true,
  },
  {
    key: "views",
    field: "viewsEnabled",
    titleKey: "settings:projectFeatures.items.views.title",
    descriptionKey: "settings:projectFeatures.items.views.description",
    icon: Layers,
    isAvailable: true,
  },
  {
    key: "pages",
    field: "pagesEnabled",
    titleKey: "settings:projectFeatures.items.pages.title",
    descriptionKey: "settings:projectFeatures.items.pages.description",
    icon: FileText,
    isAvailable: true,
  },
  {
    key: "intake",
    field: "intakeEnabled",
    titleKey: "settings:projectFeatures.items.intake.title",
    descriptionKey: "settings:projectFeatures.items.intake.description",
    icon: Inbox,
    isAvailable: true,
  },
  {
    key: "estimates",
    field: "estimatesEnabled",
    titleKey: "settings:projectFeatures.items.estimates.title",
    descriptionKey: "settings:projectFeatures.items.estimates.description",
    icon: Ruler,
    isAvailable: true,
  },
  {
    key: "timeTracking",
    field: "timeTrackingEnabled",
    titleKey: "settings:projectFeatures.items.timeTracking.title",
    descriptionKey: "settings:projectFeatures.items.timeTracking.description",
    icon: Timer,
    isAvailable: true,
  },
];

const FEATURES_BY_KEY = new Map(
  PROJECT_FEATURES.map((feature) => [feature.key, feature]),
);

export function getProjectFeature(
  key: ProjectFeatureKey,
): ProjectFeatureDefinition {
  const feature = FEATURES_BY_KEY.get(key);
  if (!feature) throw new Error(`Unknown project feature: ${key}`);
  return feature;
}

export function getAvailableProjectFeatures(): ProjectFeatureDefinition[] {
  return PROJECT_FEATURES.filter((feature) => feature.isAvailable);
}

type ProjectWithFlags = Partial<Pick<Project, ProjectFeatureField>>;

/** On for this project and shipped in the web app. */
export function isProjectFeatureEnabled(
  project: ProjectWithFlags | null | undefined,
  key: ProjectFeatureKey,
): boolean {
  const feature = FEATURES_BY_KEY.get(key);
  if (!feature?.isAvailable || !project) return false;
  return project[feature.field] === true;
}
