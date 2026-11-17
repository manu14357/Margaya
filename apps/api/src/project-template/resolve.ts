import { TEMPLATE_LABEL_KEYS } from "@margaya/whiteboard";
import { toSlug } from "../column/controllers/create-column";
import type { ColumnGroup } from "../column/groups";
import type { EstimateType } from "../estimate/types";
import {
  type CanonicalValue,
  canonicalizeEstimateValue,
} from "../estimate/validate-points";
import {
  PROJECT_FEATURE_KEYS,
  PROJECT_FEATURES,
  type ProjectFeature,
  type ProjectFeatureField,
} from "../project/features";
import { DEFAULT_LOCALE, type TextSource } from "./text";
import type {
  ColumnKey,
  CustomFieldDef,
  FieldKey,
  LabelColor,
  LabelKey,
  ProjectTemplate,
} from "./types";

// Definition + locale -> ResolvedTemplate. Pure: no database. Every text key
// the definition uses is looked up once; references stay template-local keys
// until apply time (build.ts maps them to ids).

export const WHITEBOARD_LABEL_PREFIX = "whiteboards:templates.labels.";
const TEXT_PREFIX = "projectTemplates:";

/** The column API's own slug rule, so template columns match it exactly. */
export const toColumnSlug = toSlug;

/** Database defaults of the feature switches for a new project. */
export const DEFAULT_FEATURES: Record<ProjectFeature, boolean> = {
  cycles: true,
  modules: true,
  views: true,
  pages: true,
  whiteboards: true,
  intake: false,
  estimates: false,
  timeTracking: true,
  ai: true,
  updates: false,
};

export type ResolvedColumn = {
  key: ColumnKey;
  name: string;
  slug: string;
  group: ColumnGroup;
  icon: string | null;
  color: string | null;
  position: number;
  isFinal: boolean;
};

export type ResolvedLabel = { key: LabelKey; name: string; color: LabelColor };

export type ResolvedField = {
  key: FieldKey;
  name: string;
  type: CustomFieldDef["type"];
  required: boolean;
  defaultValue: string | null;
  /** Dropdown option texts in order; null for other types. */
  options: string[] | null;
  /** Dropdown option key -> text. */
  optionText: Record<string, string>;
  position: number;
};

export type ResolvedEstimate = {
  name: string;
  type: EstimateType;
  /** Definition value -> canonical point (null when the value is invalid). */
  points: { value: string; point: CanonicalValue | null; rawText: string }[];
};

export type ResolvedTemplate = {
  definition: ProjectTemplate;
  locale: string;
  /** Text of a key used by the definition, in this locale. */
  t(key: string): string;
  /** Keys with no text in this locale (strict) or anywhere (lenient). */
  missing: string[];
  name: string;
  pitch: string;
  description: string;
  projectDescription: string | null;
  /** All ten switches, defaults filled in, as project table fields. */
  features: Record<ProjectFeatureField, boolean>;
  columns: ResolvedColumn[];
  /** The first open column (backlog, unstarted, started), or null. */
  entryColumnKey: ColumnKey | null;
  labels: ResolvedLabel[];
  fields: ResolvedField[];
  estimate: ResolvedEstimate | null;
};

/** Every text key a definition uses, whiteboard labels included. */
export function textKeysOf(definition: ProjectTemplate): string[] {
  const keys = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      if (value.startsWith(TEXT_PREFIX)) keys.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(definition);
  for (const board of definition.whiteboards ?? []) {
    for (const label of TEMPLATE_LABEL_KEYS[board.board] ?? []) {
      keys.add(`${WHITEBOARD_LABEL_PREFIX}${label}`);
    }
  }
  return [...keys];
}

/** Feature switches merged as project table fields. */
export function featureFields(
  ...layers: (Partial<Record<ProjectFeature, boolean>> | undefined)[]
): Record<ProjectFeatureField, boolean> {
  const merged: Record<ProjectFeature, boolean> = { ...DEFAULT_FEATURES };
  for (const layer of layers) {
    for (const feature of PROJECT_FEATURE_KEYS) {
      const value = layer?.[feature];
      if (typeof value === "boolean") merged[feature] = value;
    }
  }
  return Object.fromEntries(
    PROJECT_FEATURE_KEYS.map((feature) => [
      PROJECT_FEATURES[feature].field,
      merged[feature],
    ]),
  ) as Record<ProjectFeatureField, boolean>;
}

export class TemplateTextError extends Error {
  constructor(
    readonly templateId: string,
    readonly keys: string[],
  ) {
    super(
      `Template ${templateId} has no text for ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "..." : ""}`,
    );
  }
}

/**
 * Resolves a definition in one locale. `strict` (the checker) reads only that
 * locale and reports missing keys; otherwise a key falls back to en-US and a
 * key missing there too throws TemplateTextError (a definition bug the
 * checker catches before release).
 */
export function resolveTemplate(
  definition: ProjectTemplate,
  locale: string,
  source: TextSource,
  { strict = false }: { strict?: boolean } = {},
): ResolvedTemplate {
  const text = new Map<string, string>();
  const missing: string[] = [];
  for (const key of textKeysOf(definition)) {
    const value =
      source.lookup(locale, key) ??
      (strict ? undefined : source.lookup(DEFAULT_LOCALE, key));
    if (value === undefined) missing.push(key);
    else text.set(key, value);
  }
  if (missing.length > 0 && !strict) {
    throw new TemplateTextError(definition.id, missing);
  }
  const t = (key: string): string => text.get(key) ?? "";

  const columns: ResolvedColumn[] = definition.columns.map(
    (column, position) => {
      const name = t(column.name).trim();
      return {
        key: column.key,
        name,
        slug: toColumnSlug(name),
        group: column.group,
        icon: column.icon ?? null,
        color: column.color ?? null,
        position,
        isFinal: column.group === "completed" || column.group === "cancelled",
      };
    },
  );
  const entry = columns.find(
    (column) =>
      column.group === "backlog" ||
      column.group === "unstarted" ||
      column.group === "started",
  );

  const fields: ResolvedField[] = (definition.customFields ?? []).map(
    (field, position) => {
      const optionText: Record<string, string> = {};
      let defaultValue: string | null = null;
      if (field.type === "dropdown") {
        for (const option of field.options) {
          optionText[option.key] = t(option.label).trim();
        }
        defaultValue =
          field.defaultOption !== undefined
            ? (optionText[field.defaultOption] ?? null)
            : null;
      } else if (field.type === "text") {
        defaultValue =
          field.defaultValue !== undefined ? t(field.defaultValue) : null;
      } else {
        defaultValue = field.defaultValue ?? null;
      }
      return {
        key: field.key,
        name: t(field.name).trim(),
        type: field.type,
        required: field.required ?? false,
        defaultValue,
        options:
          field.type === "dropdown"
            ? field.options.map((option) => optionText[option.key] ?? "")
            : null,
        optionText,
        position: position + 1,
      };
    },
  );

  const estimateDef = definition.estimate;
  const estimate: ResolvedEstimate | null = estimateDef
    ? {
        name: t(estimateDef.name).trim(),
        type: estimateDef.type,
        points: estimateDef.values.map((value) => {
          const rawText =
            estimateDef.type === "categories" ? t(value) : String(value);
          const result = canonicalizeEstimateValue(estimateDef.type, rawText);
          return { value, rawText, point: result.ok ? result.point : null };
        }),
      }
    : null;

  return {
    definition,
    locale,
    t,
    missing,
    name: t(definition.name),
    pitch: t(definition.pitch),
    description: t(definition.description),
    projectDescription: definition.project.description
      ? t(definition.project.description)
      : null,
    features: featureFields(definition.project.features),
    columns,
    entryColumnKey: entry?.key ?? null,
    labels: (definition.labels ?? []).map((label) => ({
      key: label.key,
      name: t(label.name).trim(),
      color: label.color,
    })),
    fields,
    estimate,
  };
}
