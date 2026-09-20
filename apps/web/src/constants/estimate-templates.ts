import type { EstimateType } from "@/lib/estimate/values";

// Starting points for a new estimate system. They exist only in the web app:
// the API receives plain values. Time values are minutes. Category values
// that are words are translated when the template is picked.

type TemplateWordKey =
  | "settings:projectEstimates.templates.easy"
  | "settings:projectEstimates.templates.medium"
  | "settings:projectEstimates.templates.hard"
  | "settings:projectEstimates.templates.veryHard"
  | "settings:projectEstimates.templates.small"
  | "settings:projectEstimates.templates.large";

export type EstimateTemplateValue = string | { labelKey: TemplateWordKey };

export type EstimateTemplate = {
  key: string;
  type: EstimateType;
  /** Null for "Custom", which is named after the system type. */
  titleKey:
    | "settings:projectEstimates.templates.fibonacci"
    | "settings:projectEstimates.templates.linear"
    | "settings:projectEstimates.templates.squares"
    | "settings:projectEstimates.templates.tshirt"
    | "settings:projectEstimates.templates.easyToHard"
    | "settings:projectEstimates.templates.hours"
    | "settings:projectEstimates.templates.shortTasks"
    | null;
  values: readonly EstimateTemplateValue[];
};

const word = (labelKey: TemplateWordKey) => ({ labelKey });

export const ESTIMATE_TEMPLATES: readonly EstimateTemplate[] = [
  {
    key: "fibonacci",
    type: "points",
    titleKey: "settings:projectEstimates.templates.fibonacci",
    values: ["1", "2", "3", "5", "8", "13"],
  },
  {
    key: "linear",
    type: "points",
    titleKey: "settings:projectEstimates.templates.linear",
    values: ["1", "2", "3", "4", "5", "6"],
  },
  {
    key: "squares",
    type: "points",
    titleKey: "settings:projectEstimates.templates.squares",
    values: ["1", "4", "9", "16", "25", "36"],
  },
  {
    key: "tshirt",
    type: "categories",
    titleKey: "settings:projectEstimates.templates.tshirt",
    values: ["XS", "S", "M", "L", "XL", "XXL"],
  },
  {
    key: "easyToHard",
    type: "categories",
    titleKey: "settings:projectEstimates.templates.easyToHard",
    values: [
      word("settings:projectEstimates.templates.easy"),
      word("settings:projectEstimates.templates.medium"),
      word("settings:projectEstimates.templates.hard"),
      word("settings:projectEstimates.templates.veryHard"),
    ],
  },
  {
    key: "hours",
    type: "time",
    titleKey: "settings:projectEstimates.templates.hours",
    values: ["60", "120", "180", "240", "360", "480"],
  },
  {
    key: "shortTasks",
    type: "time",
    titleKey: "settings:projectEstimates.templates.shortTasks",
    values: ["15", "30", "60", "120", "240", "480"],
  },
];

export const CUSTOM_ESTIMATE_TEMPLATES: Record<EstimateType, EstimateTemplate> =
  {
    points: {
      key: "custom",
      type: "points",
      titleKey: null,
      values: ["1", "2"],
    },
    categories: {
      key: "custom",
      type: "categories",
      titleKey: null,
      values: [
        word("settings:projectEstimates.templates.small"),
        word("settings:projectEstimates.templates.large"),
      ],
    },
    time: { key: "custom", type: "time", titleKey: null, values: ["30", "60"] },
  };

export function templatesForType(type: EstimateType): EstimateTemplate[] {
  return ESTIMATE_TEMPLATES.filter((template) => template.type === type);
}

/** A template's stored values, with its words translated. */
export function resolveTemplateValues(
  template: EstimateTemplate,
  t: (key: string) => string,
): string[] {
  return template.values.map((value) =>
    typeof value === "string" ? value : t(value.labelKey),
  );
}
