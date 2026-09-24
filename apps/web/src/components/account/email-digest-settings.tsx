import React from "react";
import { useTranslation } from "react-i18next";
import { SettingsSection } from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NotificationPreferences } from "@/fetchers/notification-preferences/get-notification-preferences";
import type { UpdateNotificationPreferencesRequest } from "@/fetchers/notification-preferences/update-notification-preferences";

type DigestFrequency = NotificationPreferences["digestFrequency"];

const FREQUENCY_KEYS = {
  off: "settings:notificationsPage.digestFrequencyOff",
  daily: "settings:notificationsPage.digestFrequencyDaily",
  weekly: "settings:notificationsPage.digestFrequencyWeekly",
} as const;

// Index = weekday number the API stores (0 = Sunday).
const WEEKDAY_KEYS = [
  "settings:notificationsPage.digestWeekdaySunday",
  "settings:notificationsPage.digestWeekdayMonday",
  "settings:notificationsPage.digestWeekdayTuesday",
  "settings:notificationsPage.digestWeekdayWednesday",
  "settings:notificationsPage.digestWeekdayThursday",
  "settings:notificationsPage.digestWeekdayFriday",
  "settings:notificationsPage.digestWeekdaySaturday",
] as const;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

type DigestState = {
  frequency: DigestFrequency;
  weekday: number;
  hour: number;
};

export function EmailDigestSettings({
  isSaving,
  onSave,
  preferences,
}: {
  isSaving: boolean;
  onSave: (json: UpdateNotificationPreferencesRequest) => Promise<unknown>;
  preferences: NotificationPreferences | undefined;
}) {
  const { t } = useTranslation();
  const frequencyId = React.useId();
  const weekdayId = React.useId();
  const hourId = React.useId();
  const [state, setState] = React.useState<DigestState>({
    frequency: "off",
    weekday: 1,
    hour: 8,
  });

  React.useEffect(() => {
    if (!preferences) return;
    setState({
      frequency: preferences.digestFrequency ?? "off",
      weekday: preferences.digestWeekday ?? 1,
      hour: preferences.digestHour ?? 8,
    });
  }, [preferences]);

  const hasEmail = Boolean(preferences?.emailAddress);
  const isOff = state.frequency === "off";

  return (
    <SettingsSection
      title={t("settings:notificationsPage.digestTitle")}
      description={t("settings:notificationsPage.digestDescription")}
    >
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor={frequencyId}>
              {t("settings:notificationsPage.digestFrequencyLabel")}
            </Label>
            <Select
              disabled={!hasEmail || isSaving}
              onValueChange={(value) =>
                setState((current) => ({
                  ...current,
                  frequency: value as DigestFrequency,
                }))
              }
              value={state.frequency}
            >
              <SelectTrigger className="w-36" id={frequencyId}>
                <SelectValue>{t(FREQUENCY_KEYS[state.frequency])}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FREQUENCY_KEYS) as DigestFrequency[]).map(
                  (frequency) => (
                    <SelectItem key={frequency} value={frequency}>
                      {t(FREQUENCY_KEYS[frequency])}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          {state.frequency === "weekly" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor={weekdayId}>
                {t("settings:notificationsPage.digestWeekdayLabel")}
              </Label>
              <Select
                disabled={isSaving}
                onValueChange={(value) =>
                  setState((current) => ({
                    ...current,
                    weekday: Number(value),
                  }))
                }
                value={String(state.weekday)}
              >
                <SelectTrigger className="w-40" id={weekdayId}>
                  <SelectValue>
                    {t(WEEKDAY_KEYS[state.weekday] ?? WEEKDAY_KEYS[1])}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_KEYS.map((key, weekday) => (
                    <SelectItem key={key} value={String(weekday)}>
                      {t(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <Label htmlFor={hourId}>
              {t("settings:notificationsPage.digestHourLabel")}
            </Label>
            <Select
              disabled={isOff || isSaving}
              onValueChange={(value) =>
                setState((current) => ({ ...current, hour: Number(value) }))
              }
              value={String(state.hour)}
            >
              <SelectTrigger className="w-28" id={hourId}>
                <SelectValue>{hourLabel(state.hour)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((hour) => (
                  <SelectItem key={hour} value={String(hour)}>
                    {hourLabel(hour)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {hasEmail ? null : (
          <p className="text-xs text-muted-foreground">
            {t("settings:notificationsPage.digestNoEmail")}
          </p>
        )}

        <div className="flex justify-end border-t pt-4">
          <Button
            disabled={!hasEmail || isSaving}
            onClick={async () => {
              await onSave({
                digestFrequency: state.frequency,
                digestWeekday: state.weekday,
                digestHour: state.hour,
              });
            }}
            size="sm"
            type="button"
          >
            {t("settings:notificationsPage.saveDigest")}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
