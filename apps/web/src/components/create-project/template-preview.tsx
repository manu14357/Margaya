import { Check, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TemplateArt } from "@/components/project-templates/template-art";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  ProjectTemplateCategory,
  ProjectTemplatePreview,
} from "@/fetchers/project-template/project-templates";
import { cn } from "@/lib/cn";
import { COLUMN_GROUP_META, type ColumnGroup } from "@/lib/column-groups";
import {
  DEFAULT_PROJECT_FEATURES,
  PROJECT_FEATURES,
  type ProjectFeatureKey,
} from "./project-features";

const EXAMPLE_ROWS = 4;

const FIELD_TYPE_KEYS = {
  text: "common:modals.createProject.preview.fieldTypes.text",
  number: "common:modals.createProject.preview.fieldTypes.number",
  date: "common:modals.createProject.preview.fieldTypes.date",
  dropdown: "common:modals.createProject.preview.fieldTypes.dropdown",
  boolean: "common:modals.createProject.preview.fieldTypes.boolean",
} as const;

const DEFAULT_STATUS_KEYS = [
  {
    key: "common:modals.createProject.blank.statuses.todo",
    group: "unstarted",
  },
  {
    key: "common:modals.createProject.blank.statuses.inProgress",
    group: "started",
  },
  {
    key: "common:modals.createProject.blank.statuses.inReview",
    group: "started",
  },
  {
    key: "common:modals.createProject.blank.statuses.done",
    group: "completed",
  },
] as const;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </h4>
      {children}
    </section>
  );
}

function StatusList({
  statuses,
}: {
  statuses: readonly { name: string; group: ColumnGroup }[];
}) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-1.5">
      {statuses.map((status, index) => {
        const meta = COLUMN_GROUP_META[status.group];
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: statuses are an ordered list that can repeat names
            key={`${status.name}-${index}`}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs"
            title={t(meta.labelKey)}
          >
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: meta.color }}
            />
            <span className="text-foreground">{status.name}</span>
            <span className="sr-only">({t(meta.labelKey)})</span>
          </li>
        );
      })}
    </ul>
  );
}

function FeatureChips({
  features,
}: {
  features: Partial<Record<ProjectFeatureKey, boolean>>;
}) {
  const { t } = useTranslation();
  const on = PROJECT_FEATURES.filter((feature) => features[feature.key]);
  if (on.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        {t("common:modals.createProject.preview.noFeatures")}
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {on.map((feature) => (
        <li key={feature.key}>
          <Badge variant="outline" className="gap-1">
            <Check className="size-3" aria-hidden />
            {t(feature.titleKey)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function TemplatePreviewSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="aspect-[8/5] w-full rounded-xl" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <div className="flex gap-1.5">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-14" />
      </div>
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

/** What a template creates, drawn from its resolved definition. */
export function TemplatePreviewPanel({
  preview,
  categories,
  projectKey,
  showArt = true,
  labelNote,
}: {
  preview: ProjectTemplatePreview;
  categories: readonly ProjectTemplateCategory[];
  /** The key shown in example task ids, e.g. SUP-1. */
  projectKey?: string;
  showArt?: boolean;
  /** Shown when labels will be skipped (no label:create). */
  labelNote?: string;
}) {
  const { t } = useTranslation();
  const categoryNames = preview.categories
    .map((id) => categories.find((category) => category.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const examples = preview.sampleTasks.slice(0, EXAMPLE_ROWS);
  const moreExamples = preview.sampleTasks.length - examples.length;
  const key = projectKey || preview.suggestedKey;
  // The catalog description tells the template's story; the project
  // description it seeds often repeats the pitch.
  const description = preview.description || preview.projectDescription;

  return (
    <div className="space-y-4">
      {showArt && (
        <TemplateArt
          id={preview.id}
          className="overflow-hidden rounded-xl border border-border"
        />
      )}
      <div className="space-y-1">
        <h3 className="font-heading font-semibold text-base text-foreground">
          {preview.name}
        </h3>
        <p className="text-muted-foreground text-sm">{preview.pitch}</p>
        {description && description !== preview.pitch && (
          <p className="text-foreground/80 text-sm">{description}</p>
        )}
        {categoryNames.length > 0 && (
          <p className="text-muted-foreground text-xs">
            {t("common:modals.createProject.preview.goodFor", {
              categories: categoryNames.join(" · "),
            })}
          </p>
        )}
      </div>

      {preview.suggestedVisibility === "restricted" && (
        <p className="flex items-start gap-1.5 text-muted-foreground text-xs">
          <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
          {t("common:modals.createProject.preview.restricted")}
        </p>
      )}

      <Section title={t("common:modals.createProject.preview.statuses")}>
        <StatusList statuses={preview.statuses} />
      </Section>

      {preview.views.length > 0 && (
        <Section title={t("common:modals.createProject.preview.views")}>
          <ul className="flex flex-wrap gap-1.5">
            {preview.views.map((view) => (
              <li key={view.name}>
                <Badge variant="outline">{view.name}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {preview.customFields.length > 0 && (
        <Section title={t("common:modals.createProject.preview.fields")}>
          <ul className="space-y-0.5 text-sm">
            {preview.customFields.map((field) => (
              <li key={field.name} className="text-foreground">
                {field.name}
                <span className="text-muted-foreground">
                  {" · "}
                  {t(FIELD_TYPE_KEYS[field.type])}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("common:modals.createProject.preview.features")}>
        <FeatureChips
          features={
            preview.features as Partial<Record<ProjectFeatureKey, boolean>>
          }
        />
      </Section>

      {labelNote && preview.labels.length > 0 && (
        <p className="text-muted-foreground text-xs">{labelNote}</p>
      )}

      <Section title={t("common:modals.createProject.preview.examples")}>
        {examples.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("common:modals.createProject.preview.noExamples")}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {examples.map((task, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: static preview rows
                key={index}
                className="flex items-center gap-2 px-2.5 py-1.5 text-[13px]"
              >
                <span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
                  {key}-{index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {task.title}
                </span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {task.status}
                </span>
              </li>
            ))}
            {moreExamples > 0 && (
              <li className="px-2.5 py-1.5 text-muted-foreground text-xs">
                {t("common:modals.createProject.preview.more", {
                  count: moreExamples,
                })}
              </li>
            )}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** Blank without a catalog template: the API's default setup. */
export function BlankPreviewPanel() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <TemplateArt
        id="blank"
        className="overflow-hidden rounded-xl border border-border"
      />
      <div className="space-y-1">
        <h3 className="font-heading font-semibold text-base text-foreground">
          {t("common:modals.createProject.choose.blankName")}
        </h3>
        <p className="text-muted-foreground text-sm">
          {t("common:modals.createProject.choose.blankNote")}
        </p>
      </div>
      <Section title={t("common:modals.createProject.preview.statuses")}>
        <StatusList
          statuses={DEFAULT_STATUS_KEYS.map((status) => ({
            name: t(status.key),
            group: status.group,
          }))}
        />
      </Section>
      <Section title={t("common:modals.createProject.preview.features")}>
        <FeatureChips features={DEFAULT_PROJECT_FEATURES} />
      </Section>
      <p className="text-muted-foreground text-xs">
        {t("common:modals.createProject.preview.noExamples")}
      </p>
    </div>
  );
}

/** An existing project as the source: its switches, and what is copied. */
export function ProjectSourcePreviewPanel({
  name,
  slug,
  features,
}: {
  name: string;
  slug: string;
  features: Partial<Record<ProjectFeatureKey, boolean>>;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-heading font-semibold text-base text-foreground">
          {name}
        </h3>
        <p className="font-mono text-muted-foreground text-xs">{slug}</p>
      </div>
      <p className="text-muted-foreground text-sm">
        {t("common:modals.createProject.copyHint")}
      </p>
      <Section title={t("common:modals.createProject.preview.features")}>
        <FeatureChips features={features} />
      </Section>
    </div>
  );
}

export function PreviewRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className={cn("min-w-0", className)}>
      {children}
    </section>
  );
}
