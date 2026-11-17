import { createHash } from "node:crypto";
import { buildRule, buildView, placeholderRefs } from "./build";
import { CATEGORIES } from "./categories";
import { TEMPLATE_DEFINITIONS } from "./definitions";
import { resolveTemplate } from "./resolve";
import { type AppLocale, templateTextSource } from "./text";
import type { ProjectTemplate } from "./types";

// The registered templates, their gallery summaries and previews. Summaries
// and previews are resolved once per locale and kept in memory (a few
// kilobytes each); CATALOG_REVISION changes whenever a definition does.

/** Retired ids stay reserved forever; they never come back as new templates. */
export const RETIRED_TEMPLATE_IDS: readonly string[] = [];

const BY_ID = new Map<string, ProjectTemplate>(
  TEMPLATE_DEFINITIONS.filter(
    (template) => !RETIRED_TEMPLATE_IDS.includes(template.id),
  ).map((template) => [template.id, template]),
);

export function listTemplates(): ProjectTemplate[] {
  return [...BY_ID.values()];
}

export function findTemplate(id: string): ProjectTemplate | null {
  return BY_ID.get(id) ?? null;
}

export const CATALOG_REVISION = createHash("sha1")
  .update(
    JSON.stringify(
      [...BY_ID.values()].map((template) => [template.id, template.version]),
    ),
  )
  .digest("hex")
  .slice(0, 12);

function counts(template: ProjectTemplate) {
  const sampleTasks = template.sample?.tasks ?? [];
  return {
    statuses: template.columns.length,
    labels: template.labels?.length ?? 0,
    customFields: template.customFields?.length ?? 0,
    views: template.views?.length ?? 0,
    automationRules: template.automationRules?.length ?? 0,
    taskTemplates: template.taskTemplates?.length ?? 0,
    pages: template.pages?.length ?? 0,
    whiteboards: template.whiteboards?.length ?? 0,
    modules: template.modules?.length ?? 0,
    sampleTasks: sampleTasks.reduce(
      (total, task) => total + 1 + (task.subtasks?.length ?? 0),
      0,
    ),
  };
}

function summary(template: ProjectTemplate, locale: AppLocale) {
  const resolved = resolveTemplate(template, locale, templateTextSource());
  const sampleCounts = counts(template);
  return {
    id: template.id,
    version: template.version,
    categories: [...template.categories],
    featured: template.featured ?? false,
    icon: template.icon,
    name: resolved.name,
    pitch: resolved.pitch,
    description: resolved.description,
    suggestedKey: template.suggestedKey,
    suggestedVisibility: template.suggestedVisibility ?? "open",
    counts: sampleCounts,
    hasSampleData: sampleCounts.sampleTasks > 0,
  };
}

export type TemplateSummary = ReturnType<typeof summary>;

const catalogCache = new Map<AppLocale, ReturnType<typeof buildCatalog>>();

function buildCatalog(locale: AppLocale) {
  const source = templateTextSource();
  const text = (key: string) =>
    source.lookup(locale, key) ?? source.lookup("en-US", key) ?? "";
  return {
    revision: CATALOG_REVISION,
    locale,
    categories: CATEGORIES.map((category) => ({
      id: category.id,
      icon: category.icon,
      name: text(category.name),
      description: text(category.description),
    })),
    templates: listTemplates().map((template) => summary(template, locale)),
  };
}

export function catalogFor(locale: AppLocale) {
  let catalog = catalogCache.get(locale);
  if (!catalog) {
    catalog = buildCatalog(locale);
    catalogCache.set(locale, catalog);
  }
  return catalog;
}

const previewCache = new Map<string, ReturnType<typeof buildPreview>>();

function buildPreview(template: ProjectTemplate, locale: AppLocale) {
  const resolved = resolveTemplate(template, locale, templateTextSource());
  const { t } = resolved;
  const refs = placeholderRefs();
  const columnName = (key: string) =>
    resolved.columns.find((column) => column.key === key)?.name ?? key;
  return {
    ...summary(template, locale),
    projectDescription: resolved.projectDescription,
    features: Object.fromEntries(
      Object.entries(template.project.features),
    ) as Record<string, boolean>,
    statuses: resolved.columns.map((column) => ({
      name: column.name,
      group: column.group,
    })),
    labels: resolved.labels.map((label) => ({
      name: label.name,
      color: label.color,
    })),
    customFields: resolved.fields.map((field) => ({
      name: field.name,
      type: field.type,
      required: field.required,
      options: field.options,
    })),
    estimate: resolved.estimate
      ? {
          name: resolved.estimate.name,
          type: resolved.estimate.type,
          values: resolved.estimate.points.map((point) => point.rawText),
        }
      : null,
    modules: (template.modules ?? []).map((module) => t(module.name)),
    taskTemplates: (template.taskTemplates ?? []).map((item) => t(item.name)),
    views: (template.views ?? []).map((view) => {
      const built = buildView(resolved, view, refs);
      return { name: built.name, layout: built.display.layout };
    }),
    automations: (template.automationRules ?? []).flatMap((rule) => {
      const built = buildRule(resolved, rule, refs);
      return built
        ? [
            {
              name: built.name,
              trigger: built.trigger.type,
              actions: built.actions.map((action) => action.type),
            },
          ]
        : [];
    }),
    scheduledAutomations: {
      autoArchive: template.scheduledAutomations?.autoArchive?.enabled ?? false,
      autoClose: template.scheduledAutomations?.autoClose?.enabled ?? false,
      cycleRollover:
        template.scheduledAutomations?.cycleRollover?.enabled ?? false,
      flowAlerts: template.scheduledAutomations?.flowAlerts?.enabled ?? false,
    },
    intakeForm: Boolean(template.intakeForm),
    pages: (template.pages ?? []).map((page) => t(page.title)),
    whiteboards: (template.whiteboards ?? []).map((board) => t(board.title)),
    sampleTasks: (template.sample?.tasks ?? []).map((task) => ({
      title: t(task.title),
      status: columnName(task.column),
      priority: task.priority ?? "no-priority",
      labels: (task.labels ?? []).map(
        (key) =>
          resolved.labels.find((label) => label.key === key)?.name ?? key,
      ),
    })),
  };
}

export function previewFor(template: ProjectTemplate, locale: AppLocale) {
  const key = `${template.id}:${locale}`;
  let preview = previewCache.get(key);
  if (!preview) {
    preview = buildPreview(template, locale);
    previewCache.set(key, preview);
  }
  return preview;
}
