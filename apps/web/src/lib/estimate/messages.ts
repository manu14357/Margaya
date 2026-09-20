import type { EstimateErrorCode, EstimateType } from "./values";

// Static i18n keys for the estimate codes the API and the web share.

export const ESTIMATE_TYPE_LABEL_KEYS = {
  points: "settings:projectEstimates.types.points",
  categories: "settings:projectEstimates.types.categories",
  time: "settings:projectEstimates.types.time",
} as const satisfies Record<EstimateType, string>;

const ERROR_KEYS = {
  empty: "settings:projectEstimates.validation.empty",
  too_long: "settings:projectEstimates.validation.too_long",
  not_numeric: "settings:projectEstimates.validation.not_numeric",
  numeric_category: "settings:projectEstimates.validation.numeric_category",
  not_positive: "settings:projectEstimates.validation.not_positive",
  too_large: "settings:projectEstimates.validation.too_large",
  too_precise: "settings:projectEstimates.validation.too_precise",
  duplicate: "settings:projectEstimates.validation.duplicate",
  // Plural-looking suffixes (_few, _many) would clash with i18next plurals.
  too_few: "settings:projectEstimates.validation.tooFew",
  too_many: "settings:projectEstimates.validation.tooMany",
} as const satisfies Record<EstimateErrorCode, string>;

/** The message key for a value error; time systems ask for a duration. */
export function estimateErrorKey(
  type: EstimateType,
  code: EstimateErrorCode,
): string {
  if (type === "time" && code === "not_numeric") {
    return "settings:projectEstimates.validation.not_numeric_time";
  }
  return ERROR_KEYS[code];
}

export const ESTIMATE_REASON_KEYS = {
  point_deleted: "activity:estimateReason.point_deleted",
  system_switched: "activity:estimateReason.system_switched",
  system_deleted: "activity:estimateReason.system_deleted",
  task_moved: "activity:estimateReason.task_moved",
} as const;

export type EstimateChangeReason = keyof typeof ESTIMATE_REASON_KEYS;

export function isEstimateChangeReason(
  value: unknown,
): value is EstimateChangeReason {
  return typeof value === "string" && value in ESTIMATE_REASON_KEYS;
}

const PLACEHOLDER_KEYS = {
  points: "settings:projectEstimates.values.placeholder.points",
  categories: "settings:projectEstimates.values.placeholder.categories",
  time: "settings:projectEstimates.values.placeholder.time",
} as const satisfies Record<EstimateType, string>;

export function estimatePlaceholderKey(type: EstimateType): string {
  return PLACEHOLDER_KEYS[type];
}
