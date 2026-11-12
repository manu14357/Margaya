import { Info, RefreshCw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsGroupMessage,
  SettingsRow,
  SettingsSaveFooter,
  SettingsSection,
} from "@/components/settings-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { IntakeFormSettings } from "@/fetchers/intake-sources/intake-sources";
import { useIntakeFormMutations } from "@/hooks/mutations/intake-sources/use-intake-source-mutations";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import { useIntakeFormSettings } from "@/hooks/queries/intake-sources/use-intake-sources";
import { requestFormUrl } from "@/lib/intake-sources";
import { toast } from "@/lib/toast";
import CopyField from "./copy-field";

type FieldMode = IntakeFormSettings["emailField"];

type Draft = {
  title: string;
  intro: string;
  descriptionField: FieldMode;
  emailField: FieldMode;
  nameField: FieldMode;
  customFieldIds: string[];
  confirmationMessage: string;
};

function draftOf(settings: IntakeFormSettings): Draft {
  return {
    title: settings.title ?? "",
    intro: settings.intro ?? "",
    descriptionField: settings.descriptionField,
    emailField: settings.emailField,
    nameField: settings.nameField,
    customFieldIds: settings.customFieldIds,
    confirmationMessage: settings.confirmationMessage ?? "",
  };
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function ModeSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: FieldMode;
  onChange: (value: FieldMode) => void;
}) {
  const { t } = useTranslation();
  const label = (mode: FieldMode) =>
    mode === "off"
      ? t("settings:projectIntake.form.modeOff")
      : mode === "required"
        ? t("settings:projectIntake.form.modeRequired")
        : t("settings:projectIntake.form.modeOptional");
  return (
    <Select
      value={value}
      onValueChange={(next) =>
        onChange(next === "off" || next === "required" ? next : "optional")
      }
    >
      <SelectTrigger id={id} className="w-36">
        <SelectValue>{label(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(["optional", "required", "off"] as const).map((mode) => (
          <SelectItem key={mode} value={mode}>
            {label(mode)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The project's public request form: link, fields and copy. */
export default function RequestFormSettings({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } =
    useIntakeFormSettings(projectId);

  return (
    <SettingsSection
      title={t("settings:projectIntake.form.title")}
      description={t("settings:projectIntake.form.description")}
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : isError || !data ? (
        <SettingsGroup>
          <SettingsGroupMessage tone="error">
            {t("settings:projectIntake.loadError")}{" "}
            <Button variant="link" size="xs" onClick={() => refetch()}>
              {t("settings:projectIntake.retry")}
            </Button>
          </SettingsGroupMessage>
        </SettingsGroup>
      ) : (
        <RequestFormEditor projectId={projectId} settings={data} />
      )}
    </SettingsSection>
  );
}

function RequestFormEditor({
  projectId,
  settings,
}: {
  projectId: string;
  settings: IntakeFormSettings;
}) {
  const { t } = useTranslation();
  const ids = {
    enabled: useId(),
    link: useId(),
    title: useId(),
    intro: useId(),
    description: useId(),
    email: useId(),
    name: useId(),
    confirmation: useId(),
  };
  const { update, rotate } = useIntakeFormMutations(projectId);
  const { data: customFields } = useGetCustomFieldsByProject(projectId);
  const [draft, setDraft] = useState(() => draftOf(settings));

  useEffect(() => setDraft(draftOf(settings)), [settings]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(settings));
  const url = requestFormUrl(settings.path, window.location.origin);

  const save = async (
    patch: Parameters<typeof update.mutateAsync>[0],
    success: string,
  ) => {
    try {
      await update.mutateAsync(patch);
      toast.success(success);
    } catch (error) {
      toast.error(errorText(error, t("settings:projectIntake.saveError")));
    }
  };

  const toggleField = (id: string, checked: boolean) =>
    setDraft((current) => ({
      ...current,
      customFieldIds: checked
        ? [...current.customFieldIds, id]
        : current.customFieldIds.filter((fieldId) => fieldId !== id),
    }));

  return (
    <div className="space-y-4">
      {!settings.publicSharingAllowed && (
        <Alert variant="warning">
          <Info />
          <AlertDescription>
            {t("settings:projectIntake.form.sharingOff")}
          </AlertDescription>
        </Alert>
      )}
      <SettingsGroup>
        <SettingsRow
          label={t("settings:projectIntake.form.enabled")}
          description={t("settings:projectIntake.form.enabledHint")}
          htmlFor={ids.enabled}
        >
          <Switch
            id={ids.enabled}
            checked={settings.enabled}
            disabled={
              update.isPending ||
              (!settings.publicSharingAllowed && !settings.enabled)
            }
            onCheckedChange={(enabled) =>
              void save(
                { enabled },
                enabled
                  ? t("settings:projectIntake.form.opened")
                  : t("settings:projectIntake.form.closed"),
              )
            }
          />
        </SettingsRow>
        {url && (
          <SettingsRow
            label={t("settings:projectIntake.form.link")}
            description={t("settings:projectIntake.form.linkHint")}
            htmlFor={ids.link}
            stacked
          >
            <div className="flex flex-wrap items-center gap-2">
              <CopyField id={ids.link} value={url} openable />
              <Button
                size="sm"
                variant="ghost"
                loading={rotate.isPending}
                onClick={() =>
                  rotate
                    .mutateAsync()
                    .then(() =>
                      toast.success(t("settings:projectIntake.form.rotated")),
                    )
                    .catch((error: unknown) =>
                      toast.error(
                        errorText(error, t("settings:projectIntake.saveError")),
                      ),
                    )
                }
              >
                <RefreshCw className="size-3.5" />
                {t("settings:projectIntake.form.rotate")}
              </Button>
            </div>
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow
          label={t("settings:projectIntake.form.heading")}
          description={t("settings:projectIntake.form.headingHint")}
          htmlFor={ids.title}
          stacked
        >
          <Input
            id={ids.title}
            value={draft.title}
            maxLength={200}
            placeholder={t("intake:publicForm.defaultTitle")}
            onChange={(event) =>
              setDraft((d) => ({ ...d, title: event.target.value }))
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings:projectIntake.form.intro")}
          htmlFor={ids.intro}
          stacked
        >
          <Textarea
            id={ids.intro}
            value={draft.intro}
            maxLength={2_000}
            rows={3}
            onChange={(event) =>
              setDraft((d) => ({ ...d, intro: event.target.value }))
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings:projectIntake.form.descriptionField")}
          htmlFor={ids.description}
        >
          <ModeSelect
            id={ids.description}
            value={draft.descriptionField}
            onChange={(descriptionField) =>
              setDraft((d) => ({ ...d, descriptionField }))
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings:projectIntake.form.emailField")}
          description={t("settings:projectIntake.form.emailFieldHint")}
          htmlFor={ids.email}
        >
          <ModeSelect
            id={ids.email}
            value={draft.emailField}
            onChange={(emailField) => setDraft((d) => ({ ...d, emailField }))}
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings:projectIntake.form.nameField")}
          htmlFor={ids.name}
        >
          <ModeSelect
            id={ids.name}
            value={draft.nameField}
            onChange={(nameField) => setDraft((d) => ({ ...d, nameField }))}
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings:projectIntake.form.customFields")}
          description={t("settings:projectIntake.form.customFieldsHint")}
          stacked
        >
          {customFields && customFields.length > 0 ? (
            <div className="grid w-full gap-2 sm:grid-cols-2">
              {customFields.map((field) => (
                // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox is inside
                <label
                  key={field.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={draft.customFieldIds.includes(field.id)}
                    onCheckedChange={(checked) =>
                      toggleField(field.id, checked === true)
                    }
                  />
                  <span className="truncate">{field.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              {t("settings:projectIntake.form.noCustomFields")}
            </p>
          )}
        </SettingsRow>
        <SettingsRow
          label={t("settings:projectIntake.form.confirmation")}
          description={t("settings:projectIntake.form.confirmationHint")}
          htmlFor={ids.confirmation}
          stacked
        >
          <Textarea
            id={ids.confirmation}
            value={draft.confirmationMessage}
            maxLength={1_000}
            rows={2}
            placeholder={t("intake:publicForm.sentBody")}
            onChange={(event) =>
              setDraft((d) => ({
                ...d,
                confirmationMessage: event.target.value,
              }))
            }
          />
        </SettingsRow>
        <SettingsSaveFooter
          dirty={dirty}
          saving={update.isPending}
          onSave={() =>
            save(
              {
                title: draft.title,
                intro: draft.intro,
                descriptionField: draft.descriptionField,
                emailField: draft.emailField,
                nameField: draft.nameField,
                customFieldIds: draft.customFieldIds,
                confirmationMessage: draft.confirmationMessage,
              },
              t("settings:projectIntake.saved"),
            )
          }
        />
      </SettingsGroup>
    </div>
  );
}
