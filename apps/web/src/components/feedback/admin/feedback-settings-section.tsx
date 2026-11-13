import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  InstanceLoadState,
  InstanceSection,
} from "@/components/instance-admin/instance-page";
import {
  SettingRow,
  SettingSwitchRow,
} from "@/components/instance-admin/setting-row";
import { useSaveInstanceSettings } from "@/components/instance-admin/use-save-instance-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useInstanceSettings } from "@/hooks/queries/instance-admin/use-instance-admin";
import type { SurveyFormat } from "@/lib/feedback";
import { indexSettings, isSettingLocked } from "@/lib/instance-settings";
import type { InstanceSettings } from "@/types/instance-admin";
import { FORMAT_KEYS } from "./feedback-labels";

const FORMATS: SurveyFormat[] = ["faces5", "faces3", "stars", "nps"];

type NumberRowProps = {
  settings: InstanceSettings;
  settingKey: string;
  label: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  fallback: number;
};

/** A whole-number setting with its own Save, like the session lifetime. */
function SettingNumberRow({
  settings,
  settingKey,
  label,
  hint,
  unit,
  min,
  max,
  fallback,
}: NumberRowProps) {
  const { t } = useTranslation();
  const entry = indexSettings(settings).get(settingKey);
  const { save, isPending } = useSaveInstanceSettings();
  const stored = Number(entry?.value ?? fallback);
  const [draft, setDraft] = useState(String(stored));
  useEffect(() => setDraft(String(stored)), [stored]);
  const value = Number(draft);
  const valid = Number.isInteger(value) && value >= min && value <= max;
  const locked = isSettingLocked(settings, entry);
  const id = `instance-setting-${settingKey.replace(/\./g, "-")}`;

  return (
    <SettingRow id={id} label={label} hint={hint} entry={entry}>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void save({ [settingKey]: value });
        }}
      >
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          className="w-20"
          value={draft}
          aria-invalid={!valid}
          disabled={locked}
          onChange={(event) => setDraft(event.target.value)}
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={isPending || !valid || locked || value === stored}
        >
          {t("settings:feedback.admin.save")}
        </Button>
      </form>
    </SettingRow>
  );
}

/** Feedback on or off, and when the occasional survey asks, on what scale. */
export function FeedbackSettingsSection() {
  const { t } = useTranslation();
  const settings = useInstanceSettings();
  const { save, isPending } = useSaveInstanceSettings();

  if (!settings.data) {
    return (
      <InstanceSection title={t("settings:feedback.admin.settingsTitle")}>
        <InstanceLoadState
          isLoading={settings.isLoading}
          isError={settings.isError}
          onRetry={() => void settings.refetch()}
          rows={4}
        />
      </InstanceSection>
    );
  }

  const data = settings.data;
  const index = indexSettings(data);
  const enabled = index.get("feedback.enabled")?.value !== false;
  const surveyOn =
    enabled && index.get("feedback.survey.enabled")?.value === true;
  const formatEntry = index.get("feedback.survey.format");
  const format = (formatEntry?.value as SurveyFormat | undefined) ?? "faces5";

  return (
    <>
      <InstanceSection
        title={t("settings:feedback.admin.settingsTitle")}
        description={t("settings:feedback.admin.settingsDescription")}
      >
        <SettingSwitchRow
          settings={data}
          settingKey="feedback.enabled"
          label={t("settings:feedback.admin.enabled")}
          hint={t("settings:feedback.admin.enabledHint")}
        />
      </InstanceSection>

      <InstanceSection
        title={t("settings:feedback.admin.surveyTitle")}
        description={t("settings:feedback.admin.surveyDescription")}
      >
        <SettingSwitchRow
          settings={data}
          settingKey="feedback.survey.enabled"
          label={t("settings:feedback.admin.surveyEnabled")}
          hint={t("settings:feedback.admin.surveyEnabledHint")}
          note={
            enabled
              ? undefined
              : t("settings:feedback.admin.surveyNeedsFeedback")
          }
        />
        {surveyOn && (
          <>
            <Separator />
            <SettingRow
              id="instance-setting-feedback-survey-format"
              label={t("settings:feedback.admin.format")}
              hint={t("settings:feedback.admin.formatHint")}
              entry={formatEntry}
            >
              <Select
                value={format}
                disabled={isPending || isSettingLocked(data, formatEntry)}
                onValueChange={(value) =>
                  void save({ "feedback.survey.format": String(value) })
                }
              >
                <SelectTrigger
                  id="instance-setting-feedback-survey-format"
                  className="w-full sm:w-56"
                >
                  <SelectValue>{t(FORMAT_KEYS[format])}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(FORMAT_KEYS[option])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />
            <SettingNumberRow
              settings={data}
              settingKey="feedback.survey.tasksCompleted"
              label={t("settings:feedback.admin.tasksCompleted")}
              hint={t("settings:feedback.admin.tasksCompletedHint")}
              unit={t("settings:feedback.admin.tasksUnit")}
              min={0}
              max={1000}
              fallback={10}
            />
            <Separator />
            <SettingNumberRow
              settings={data}
              settingKey="feedback.survey.activeDays"
              label={t("settings:feedback.admin.activeDays")}
              hint={t("settings:feedback.admin.activeDaysHint")}
              unit={t("settings:feedback.admin.daysUnit")}
              min={0}
              max={365}
              fallback={10}
            />
            <Separator />
            <SettingNumberRow
              settings={data}
              settingKey="feedback.survey.intervalDays"
              label={t("settings:feedback.admin.interval")}
              hint={t("settings:feedback.admin.intervalHint")}
              unit={t("settings:feedback.admin.daysUnit")}
              min={30}
              max={365}
              fallback={90}
            />
          </>
        )}
      </InstanceSection>
    </>
  );
}
