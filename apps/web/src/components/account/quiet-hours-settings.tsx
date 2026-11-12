import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  focusPresetLabel,
  formatUntil,
  useFocusDialog,
  useFocusMode,
} from "@/components/notification/focus-mode";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import useUpdateUserTimezone from "@/hooks/mutations/user/use-update-user-timezone";
import { normalizeNotificationSound } from "@/lib/notification-sound/settings";
import {
  FOCUS_PRESETS,
  normalizeQuietDelivery,
  QUIET_BYPASS,
  QUIET_CHANNELS,
  type QuietBypass,
  type QuietChannel,
} from "@/lib/quiet-time";
import { browserTimeZone } from "@/lib/timezones";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";

type Translate = ReturnType<typeof useTranslation>["t"];

function channelLabel(t: Translate, channel: QuietChannel): string {
  switch (channel) {
    case "push":
      return t("settings:notificationsPage.quiet.channelPush");
    case "email":
      return t("settings:notificationsPage.quiet.channelEmail");
    case "desktop":
      return t("settings:notificationsPage.quiet.channelDesktop");
    case "ntfy":
      return t("settings:notificationsPage.quiet.channelNtfy");
    case "gotify":
      return t("settings:notificationsPage.quiet.channelGotify");
    case "webhook":
      return t("settings:notificationsPage.quiet.channelWebhook");
  }
}

function bypassLabel(t: Translate, bypass: QuietBypass): string {
  switch (bypass) {
    case "mentions":
      return t("settings:notificationsPage.quiet.bypassMentions");
    case "urgent":
      return t("settings:notificationsPage.quiet.bypassUrgent");
    case "approvals":
      return t("settings:notificationsPage.quiet.bypassApprovals");
  }
}

/**
 * Quiet hours (a daily window) and focus mode (a pause from now): which
 * channels they hold, what still comes through, and the time zone they
 * follow. Everything syncs to the account through the preferences store.
 */
export function QuietHoursSettings() {
  const { t } = useTranslation();
  const ids = {
    quiet: useId(),
    quietStart: useId(),
    quietEnd: useId(),
    channels: useId(),
    bypass: useId(),
  };
  const stored = useUserPreferencesStore((state) => state.notificationSound);
  const setSound = useUserPreferencesStore(
    (state) => state.setNotificationSound,
  );
  const storedDelivery = useUserPreferencesStore(
    (state) => state.quietDelivery,
  );
  const setDelivery = useUserPreferencesStore(
    (state) => state.setQuietDelivery,
  );
  const timeZone = useUserPreferencesStore((state) => state.timeZone);
  const sound = normalizeNotificationSound(stored);
  const delivery = normalizeQuietDelivery(storedDelivery);
  const focus = useFocusMode();
  const openCustom = useFocusDialog((state) => state.setOpen);
  const { mutateAsync: saveTimezone, isPending: savingZone } =
    useUpdateUserTimezone();
  const detected = browserTimeZone();

  const toggle = <T extends string>(
    list: readonly T[],
    item: T,
    on: boolean,
  ) => (on ? [...list, item] : list.filter((value) => value !== item));

  const adoptDetectedZone = () =>
    void saveTimezone(detected).then(
      () => toast.success(t("settings:timezone.toastUpdated")),
      () => toast.error(t("settings:timezone.toastError")),
    );

  return (
    <SettingsSection
      title={t("settings:notificationsPage.quiet.title")}
      description={t("settings:notificationsPage.quiet.description")}
    >
      <SettingsGroup>
        <SettingsRow
          label={t("settings:notificationsPage.quiet.focus")}
          description={
            focus.focusing && focus.status
              ? t("navigation:focus.focusUntil", {
                  time: formatUntil(
                    focus.status.until,
                    focus.now,
                    focus.timeZone,
                  ),
                })
              : t("settings:notificationsPage.quiet.focusDescription")
          }
        >
          {focus.focusing ? (
            <Button size="sm" variant="outline" onClick={focus.end}>
              {t("navigation:focus.resume")}
            </Button>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {FOCUS_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant="outline"
                  onClick={() => focus.start(preset)}
                >
                  {focusPresetLabel(t, preset)}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openCustom(true)}
              >
                {t("navigation:focus.custom")}
              </Button>
            </div>
          )}
        </SettingsRow>

        <SettingsRow
          label={t("settings:notificationsPage.sound.quietHours")}
          description={t(
            "settings:notificationsPage.sound.quietHoursDescription",
          )}
          htmlFor={ids.quiet}
        >
          <Switch
            id={ids.quiet}
            checked={sound.quietHours}
            onCheckedChange={(quietHours) => setSound({ quietHours })}
          />
        </SettingsRow>
        {sound.quietHours && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <Label htmlFor={ids.quietStart}>
                {t("settings:notificationsPage.sound.quietFrom")}
              </Label>
              <Input
                id={ids.quietStart}
                type="time"
                size="sm"
                className="w-32"
                value={sound.quietStart}
                onChange={(event) => {
                  if (event.target.value) {
                    setSound({ quietStart: event.target.value });
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor={ids.quietEnd}>
                {t("settings:notificationsPage.sound.quietTo")}
              </Label>
              <Input
                id={ids.quietEnd}
                type="time"
                size="sm"
                className="w-32"
                value={sound.quietEnd}
                onChange={(event) => {
                  if (event.target.value) {
                    setSound({ quietEnd: event.target.value });
                  }
                }}
              />
            </div>
            <p className="basis-full text-muted-foreground text-xs">
              {timeZone
                ? t("settings:notificationsPage.quiet.timeZone", {
                    zone: timeZone,
                  })
                : t("settings:notificationsPage.quiet.noTimeZone")}
            </p>
            {!timeZone && (
              <Button
                size="sm"
                variant="outline"
                disabled={savingZone}
                onClick={adoptDetectedZone}
              >
                {t("settings:notificationsPage.quiet.useTimeZone", {
                  zone: detected,
                })}
              </Button>
            )}
          </div>
        )}

        <SettingsRow
          stacked
          label={
            <span id={ids.channels} className="font-medium text-sm">
              {t("settings:notificationsPage.quiet.channels")}
            </span>
          }
          description={t(
            "settings:notificationsPage.quiet.channelsDescription",
          )}
        >
          <fieldset
            aria-labelledby={ids.channels}
            className="m-0 grid w-full min-w-0 grid-cols-2 gap-2 border-0 p-0 sm:grid-cols-3"
          >
            {QUIET_CHANNELS.map((channel) => (
              <Label
                key={channel}
                className="flex items-center gap-2 font-normal text-sm"
              >
                <Checkbox
                  checked={delivery.channels.includes(channel)}
                  onCheckedChange={(value) =>
                    setDelivery({
                      channels: toggle(
                        delivery.channels,
                        channel,
                        Boolean(value),
                      ),
                    })
                  }
                />
                {channelLabel(t, channel)}
              </Label>
            ))}
          </fieldset>
        </SettingsRow>

        <SettingsRow
          stacked
          label={
            <span id={ids.bypass} className="font-medium text-sm">
              {t("settings:notificationsPage.quiet.bypass")}
            </span>
          }
          description={t("settings:notificationsPage.quiet.bypassDescription")}
        >
          <fieldset
            aria-labelledby={ids.bypass}
            className="m-0 grid w-full min-w-0 gap-2 border-0 p-0"
          >
            {QUIET_BYPASS.map((bypass) => (
              <Label
                key={bypass}
                className="flex items-center gap-2 font-normal text-sm"
              >
                <Checkbox
                  checked={delivery.bypass.includes(bypass)}
                  onCheckedChange={(value) =>
                    setDelivery({
                      bypass: toggle(delivery.bypass, bypass, Boolean(value)),
                    })
                  }
                />
                {bypassLabel(t, bypass)}
              </Label>
            ))}
          </fieldset>
        </SettingsRow>
      </SettingsGroup>
      <p className="text-muted-foreground text-xs">
        {t("settings:notificationsPage.quiet.summaryNote")}
      </p>
    </SettingsSection>
  );
}
