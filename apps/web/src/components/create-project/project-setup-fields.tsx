import { ChevronRight, Lock, Users } from "lucide-react";
import { type RefObject, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import type {
  CreateSource,
  SetupErrors,
  SetupForm,
  Suggestion,
  Visibility,
} from "./create-flow-model";
import { effectiveForm } from "./create-flow-model";
import { PROJECT_FEATURES, type ProjectFeatureKey } from "./project-features";
import { ProjectIconPicker } from "./project-icon-picker";

export type SetupCapabilities = {
  canCreateTasks: boolean;
  canCreateLabels: boolean;
  aiAvailable: boolean;
};

export function ProjectSetupFields({
  form,
  suggestion,
  source,
  sampleData,
  onChange,
  onFeature,
  capabilities,
  errors,
  keyConflict,
  nameRef,
  keyRef,
  keyOpen,
  onKeyOpen,
  compact = false,
  disabled = false,
}: {
  form: SetupForm;
  suggestion: Suggestion;
  source: CreateSource;
  /** The effective "Add example tasks" value. */
  sampleData: boolean;
  onChange: (change: Partial<SetupForm>) => void;
  onFeature: (key: ProjectFeatureKey, value: boolean) => void;
  capabilities: SetupCapabilities;
  /** Shown only after the first submit attempt. */
  errors: SetupErrors;
  keyConflict: string | null;
  nameRef?: RefObject<HTMLInputElement | null>;
  keyRef?: RefObject<HTMLInputElement | null>;
  keyOpen: boolean;
  onKeyOpen: (open: boolean) => void;
  /** Onboarding: features and privacy sit behind "More options". */
  compact?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const values = effectiveForm(form, suggestion);
  const [moreOpen, setMoreOpen] = useState(false);
  const showExamples =
    source.kind !== "project" &&
    suggestion.sampleTaskCount > 0 &&
    capabilities.canCreateTasks;
  const features = PROJECT_FEATURES.filter(
    (feature) => feature.key !== "ai" || capabilities.aiAvailable,
  );
  const onFeatures = features.filter((feature) => values.features[feature.key]);
  const keyError = keyConflict
    ? t("common:modals.createProject.setup.keyTaken", { key: keyConflict })
    : errors.key
      ? t("common:modals.createProject.setup.keyInvalid")
      : null;
  const nameError =
    errors.name === "required"
      ? t("common:modals.createProject.setup.nameRequired")
      : errors.name === "tooLong"
        ? t("common:modals.createProject.setup.nameTooLong")
        : null;

  const featureList = (
    <ul className="space-y-2 pt-2">
      {features.map((feature) => (
        <li key={feature.key} className="flex items-start gap-3">
          <Switch
            id={`${id}-feature-${feature.key}`}
            checked={values.features[feature.key]}
            onCheckedChange={(checked) => onFeature(feature.key, checked)}
            aria-describedby={`${id}-feature-${feature.key}-hint`}
            disabled={disabled}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <Label htmlFor={`${id}-feature-${feature.key}`}>
              {t(feature.titleKey)}
            </Label>
            <p
              id={`${id}-feature-${feature.key}-hint`}
              className="text-muted-foreground text-xs"
            >
              {t(feature.descriptionKey)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );

  const featureSection = (
    <Collapsible>
      <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-1.5 rounded-md text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 [&[data-panel-open]>svg]:rotate-90">
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150"
          aria-hidden
        />
        <span className="min-w-0">
          <span className="font-medium text-foreground">
            {t("common:modals.createProject.setup.featuresTitle")}
          </span>
          <span className="block text-muted-foreground text-xs">
            {onFeatures.length > 0
              ? t("common:modals.createProject.setup.included", {
                  list: onFeatures
                    .map((feature) => t(feature.titleKey))
                    .join(", "),
                })
              : t("common:modals.createProject.setup.includedNone")}
          </span>
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel>{featureList}</CollapsiblePanel>
    </Collapsible>
  );

  const privacySection = (
    <fieldset className="space-y-2">
      <legend
        id={`${id}-privacy`}
        className="mb-2 font-medium text-foreground text-sm"
      >
        {t("common:modals.createProject.setup.privacy")}
      </legend>
      <RadioGroup
        aria-labelledby={`${id}-privacy`}
        value={values.visibility}
        onValueChange={(value) => onChange({ visibility: value as Visibility })}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        disabled={disabled}
      >
        {(
          [
            {
              value: "open",
              icon: Users,
              titleKey: "common:modals.createProject.setup.privacyOpen",
              hintKey: "common:modals.createProject.setup.privacyOpenHint",
            },
            {
              value: "restricted",
              icon: Lock,
              titleKey: "common:modals.createProject.setup.privacyRestricted",
              hintKey:
                "common:modals.createProject.setup.privacyRestrictedHint",
            },
          ] as const
        ).map((option) => (
          // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's Radio renders its own input inside the label, which labels it
          <label
            key={option.value}
            className="relative flex min-h-11 cursor-pointer gap-2.5 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/50 has-data-checked:border-primary has-data-checked:ring-1 has-data-checked:ring-primary"
          >
            <Radio
              value={option.value}
              className="mt-0.5"
              aria-labelledby={`${id}-privacy-${option.value}`}
              aria-describedby={`${id}-privacy-${option.value}-hint`}
            />
            <span className="min-w-0">
              <span
                id={`${id}-privacy-${option.value}`}
                className="flex items-center gap-1.5 font-medium text-foreground text-sm"
              >
                <option.icon
                  className="size-3.5 text-muted-foreground"
                  aria-hidden
                />
                {t(option.titleKey)}
              </span>
              <span
                id={`${id}-privacy-${option.value}-hint`}
                className="block text-muted-foreground text-xs"
              >
                {t(option.hintKey)}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
      {suggestion.visibility === "restricted" && (
        <p className="text-muted-foreground text-xs">
          {t("common:modals.createProject.setup.privacySuggested")}
        </p>
      )}
    </fieldset>
  );

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-name`}>
          {t("common:modals.createProject.projectName")}
        </Label>
        <div className="flex items-center gap-2">
          <ProjectIconPicker
            value={values.icon}
            onChange={(icon) => onChange({ icon, iconEdited: true })}
          />
          <Input
            ref={nameRef}
            id={`${id}-name`}
            value={values.name}
            onChange={(event) =>
              onChange({ name: event.target.value, nameEdited: true })
            }
            onFocus={(event) => event.currentTarget.select()}
            placeholder={t("common:modals.createProject.setup.namePlaceholder")}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${id}-name-error` : undefined}
            maxLength={120}
            autoComplete="off"
            disabled={disabled}
            className="text-base sm:text-sm"
          />
        </div>
        {nameError && (
          <p
            id={`${id}-name-error`}
            className="text-destructive-foreground text-xs"
          >
            {nameError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1 text-muted-foreground text-sm">
          {keyOpen || keyError ? (
            <>
              <Label
                htmlFor={`${id}-key`}
                className="font-normal text-muted-foreground"
              >
                {t("common:modals.createProject.setup.keyLabel")}
              </Label>
              <Input
                ref={keyRef}
                id={`${id}-key`}
                value={values.key}
                onChange={(event) =>
                  onChange({
                    key: event.target.value.toUpperCase(),
                    keyEdited: true,
                  })
                }
                maxLength={8}
                aria-invalid={keyError ? true : undefined}
                aria-describedby={
                  keyError ? `${id}-key-error` : `${id}-key-hint`
                }
                disabled={disabled}
                className="w-28 font-mono uppercase"
                autoComplete="off"
              />
              <span id={`${id}-key-hint`} className="font-mono text-xs">
                {`${values.key || "KEY"}-1`}
              </span>
            </>
          ) : (
            <>
              <span>
                {t("common:modals.createProject.setup.keyChip", {
                  key: values.key || "KEY",
                })}
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto min-h-11 px-0 sm:min-h-0"
                onClick={() => onKeyOpen(true)}
                disabled={disabled}
              >
                {t("common:modals.createProject.setup.keyChange")}
              </Button>
            </>
          )}
        </div>
        {keyError && (
          <p
            id={`${id}-key-error`}
            role="alert"
            className="text-destructive-foreground text-xs"
          >
            {keyError}
          </p>
        )}
      </div>

      {showExamples && (
        <div className="flex items-start gap-3">
          <Switch
            id={`${id}-examples`}
            checked={sampleData}
            onCheckedChange={(checked) => onChange({ sampleData: checked })}
            aria-describedby={`${id}-examples-hint`}
            disabled={disabled}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <Label htmlFor={`${id}-examples`}>
              {t("common:modals.createProject.setup.examples")}
            </Label>
            <p
              id={`${id}-examples-hint`}
              className="text-muted-foreground text-xs"
            >
              {t("common:modals.createProject.setup.examplesHint", {
                count: suggestion.sampleTaskCount,
              })}
            </p>
          </div>
        </div>
      )}

      {source.kind === "project" && (
        <div className="space-y-2 rounded-xl border border-border px-3 py-2.5">
          <p className="text-muted-foreground text-xs">
            {t("common:modals.createProject.copyHint")}
          </p>
          <div className="flex min-h-8 items-center gap-2">
            <Checkbox
              id={`${id}-templates`}
              checked={form.copyTaskTemplates}
              onCheckedChange={(checked) =>
                onChange({ copyTaskTemplates: Boolean(checked) })
              }
              disabled={disabled}
            />
            <label htmlFor={`${id}-templates`} className="text-sm">
              {t("common:modals.createProject.includeTemplates")}
            </label>
          </div>
          {capabilities.canCreateTasks && (
            <div className="flex items-start gap-2">
              <Checkbox
                id={`${id}-tasks`}
                className="mt-0.5"
                checked={form.copyOpenTasks}
                aria-describedby={`${id}-tasks-hint`}
                onCheckedChange={(checked) =>
                  onChange({ copyOpenTasks: Boolean(checked) })
                }
                disabled={disabled}
              />
              <div className="space-y-0.5">
                <label htmlFor={`${id}-tasks`} className="text-sm">
                  {t("common:modals.createProject.includeOpenTasks")}
                </label>
                <p
                  id={`${id}-tasks-hint`}
                  className="text-muted-foreground text-xs"
                >
                  {t("common:modals.createProject.openTasksHint")}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {suggestion.hasLabels && !capabilities.canCreateLabels && (
        <p className="text-muted-foreground text-xs">
          {t("common:modals.createProject.setup.labelsSkipped")}
        </p>
      )}

      {compact ? (
        <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
          <CollapsibleTrigger className="flex min-h-11 items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 [&[data-panel-open]>svg]:rotate-90">
            <ChevronRight
              className="size-4 transition-transform duration-150"
              aria-hidden
            />
            {t("common:modals.createProject.setup.moreOptions")}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className={cn("space-y-5 pt-3")}>
              {featureSection}
              {privacySection}
            </div>
          </CollapsiblePanel>
        </Collapsible>
      ) : (
        <>
          {featureSection}
          {privacySection}
        </>
      )}
    </div>
  );
}
