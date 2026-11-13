import type { FeedbackFormat } from "@/lib/feedback";

// Static i18n keys for the admin page's choices.

export const FORMAT_KEYS: Record<FeedbackFormat, string> = {
  faces5: "settings:feedback.admin.formats.faces5",
  faces3: "settings:feedback.admin.formats.faces3",
  stars: "settings:feedback.admin.formats.stars",
  nps: "settings:feedback.admin.formats.nps",
  thumbs: "settings:feedback.admin.formats.thumbs",
};

export type FeedbackKind = "general" | "survey" | "feature";

export const KIND_KEYS: Record<FeedbackKind, string> = {
  general: "settings:feedback.admin.kinds.general",
  survey: "settings:feedback.admin.kinds.survey",
  feature: "settings:feedback.admin.kinds.feature",
};

export const FEATURE_KEYS: Record<string, string> = {
  cycles: "settings:feedback.features.cycles",
  modules: "settings:feedback.features.modules",
  pages: "settings:feedback.features.pages",
  views: "settings:feedback.features.views",
  intake: "settings:feedback.features.intake",
  analytics: "settings:feedback.features.analytics",
};

export const PERIODS = [30, 90, 180, 365] as const;
