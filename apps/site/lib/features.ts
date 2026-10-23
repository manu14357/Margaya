import { landing } from "@/lib/landing";

export const featureSlugs = [
  "plan",
  "views",
  "ai",
  "docs",
  "automate",
  "self-host",
] as const;

export type FeatureSlug = (typeof featureSlugs)[number];

// URL slugs are kebab-case; copy keys follow the i18n camelCase convention.
const copyKeys = {
  plan: "plan",
  views: "views",
  ai: "ai",
  docs: "docs",
  automate: "automate",
  "self-host": "selfHost",
} as const satisfies Record<FeatureSlug, keyof typeof landing.pages>;

export type FeatureCopyKey = (typeof copyKeys)[FeatureSlug];

export function featurePath(slug: FeatureSlug) {
  return `/features/${slug}`;
}

export function featureCopyKey(slug: FeatureSlug): FeatureCopyKey {
  return copyKeys[slug];
}

export function isFeatureSlug(slug: string): slug is FeatureSlug {
  return (featureSlugs as readonly string[]).includes(slug);
}

export function getFeaturePage(slug: FeatureSlug) {
  const copyKey = copyKeys[slug];
  return { slug, copyKey, copy: landing.pages[copyKey] };
}

export const featurePageList = featureSlugs.map(getFeaturePage);
